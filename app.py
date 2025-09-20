import os
import json
import re
import uuid
from datetime import date, datetime
from flask import Flask, request, jsonify, render_template, send_from_directory
from flask.json.provider import DefaultJSONProvider
from flask_cors import CORS
import duckdb
import pandas as pd
import numpy as np

class CustomJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (datetime, date)):
            return obj.isoformat()
        elif pd.isna(obj) or obj is None:
            return None
        elif isinstance(obj, np.integer):
            return int(obj)
        elif isinstance(obj, np.floating):
            return float(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        return super().default(obj)

class CustomJSONProvider(DefaultJSONProvider):
    def dumps(self, obj, **kwargs):
        return json.dumps(obj, **kwargs, cls=CustomJSONEncoder)

# Initialize Flask app with custom JSON encoder
app = Flask(__name__, 
            static_folder='static',
            template_folder='templates')
app.json = CustomJSONProvider(app)
CORS(app)

# Configuration
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['DATABASE_FOLDER'] = 'databases'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max upload size

# Ensure upload and database directories exist
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['DATABASE_FOLDER'], exist_ok=True)

# Store active connections with their attached databases
connections = {}

# Store attached databases for each connection
attached_databases = {}

def get_db_path(db_name):
    """Get the filesystem path for a database."""
    if db_name == 'memory':
        return ':memory:'
    return os.path.join(app.config['DATABASE_FOLDER'], f"{db_name}.db")

def get_connection(db_name):
    """Get or create a database connection with attached databases."""
    if db_name not in connections:
        # Initialize connection with the main database
        db_path = get_db_path(db_name)
        conn = duckdb.connect(database=db_path, read_only=False)
        connections[db_name] = conn
        attached_databases[db_name] = set()
        
        # Attach all other databases except the current one
        all_dbs = [f.replace('.db', '') for f in os.listdir(app.config['DATABASE_FOLDER']) 
                  if f.endswith('.db') and f != f"{db_name}.db"]
        
        for other_db in all_dbs:
            try:
                other_db_path = get_db_path(other_db)
                conn.execute(f"ATTACH DATABASE '{other_db_path}' AS {other_db}")
                attached_databases[db_name].add(other_db)
            except Exception as e:
                print(f"Warning: Could not attach database {other_db}: {e}")
    
    return connections[db_name]

def get_db_connection(db_name):
    """Get or create a database connection"""
    if db_name not in connections:
        db_path = os.path.join(app.config['DATABASE_FOLDER'], f"{db_name}.db")
        connections[db_name] = duckdb.connect(db_path, read_only=False)
    return connections[db_name]

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/query', methods=['POST'])
def execute_query():
    data = request.json
    db_name = data.get('database', 'default')
    query = data.get('query', '')
    
    if not query:
        return jsonify({'success': False, 'error': 'No query provided'}), 400
    
    try:
        conn = get_connection(db_name)
        
        # Handle ATTACH/DETACH commands
        query_upper = query.strip().upper()
        if query_upper.startswith('ATTACH DATABASE'):
            # Extract database name from the ATTACH statement
            db_match = re.search(r"AS\s+([a-zA-Z_][a-zA-Z0-9_]*)", query_upper)
            if db_match:
                attached_db = db_match.group(1).lower()
                if attached_db != db_name and attached_db not in attached_databases[db_name]:
                    attached_databases[db_name].add(attached_db)
        elif query_upper.startswith('DETACH DATABASE'):
            # Extract database name from the DETACH statement
            db_match = re.search(r"DETACH\s+(?:DATABASE\s+)?([a-zA-Z_][a-zA-Z0-9_]*)", query_upper, re.IGNORECASE)
            if db_match:
                detached_db = db_match.group(1).lower()
                if detached_db in attached_databases[db_name]:
                    attached_databases[db_name].remove(detached_db)
        
        # Execute the query
        result = conn.execute(query).fetchdf()
        
        # Handle different result types
        if result.empty:
            return jsonify({
                'success': True,
                'data': [],
                'columns': [],
                'message': 'Query executed successfully (no results)'
            })
            
        # Convert datetime columns to ISO format strings
        for col in result.select_dtypes(include=['datetime64']).columns:
            result[col] = result[col].apply(lambda x: x.isoformat() if pd.notna(x) else None)
            
        # Convert to records and handle NaNs/NaTs
        records = result.replace({np.nan: None}).to_dict('records')
        
        return jsonify({
            'success': True,
            'data': records,
            'columns': list(result.columns),
            'attached_databases': list(attached_databases[db_name])
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400

@app.route('/api/schema', methods=['GET'])
def get_schema():
    try:
        db_name = request.args.get('database', 'default')
        conn = get_connection(db_name)
        
        # Get all schemas (including attached databases)
        schemas = conn.execute("""
            SELECT schema_name 
            FROM information_schema.schemata 
            WHERE schema_name NOT LIKE 'pg_%' 
            AND schema_name != 'information_schema'
        """).fetchall()
        
        schema_info = {
            'current_database': db_name,
            'attached_databases': list(attached_databases.get(db_name, [])),
            'schemas': {}
        }
        
        for (schema_name,) in schemas:
            if schema_name in ('pg_catalog', 'information_schema'):
                continue
                
            schema_info['schemas'][schema_name] = {'tables': {}}
            
            # Get all tables in the schema
            tables = conn.execute(f"""
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = ?
                AND table_type = 'BASE TABLE'
                ORDER BY table_name
            """, (schema_name,)).fetchall()
            
            for (table_name,) in tables:
                try:
                    # Get columns for each table
                    columns = conn.execute(f"""
                        SELECT 
                            column_name, 
                            data_type,
                            is_nullable,
                            column_default
                        FROM information_schema.columns 
                        WHERE table_schema = ? 
                        AND table_name = ?
                        ORDER BY ordinal_position
                    """, (schema_name, table_name)).fetchall()
                    
                    # Format column info
                    column_info = [{
                        'name': col[0],
                        'type': col[1],
                        'nullable': col[2] == 'YES',
                        'default': col[3]
                    } for col in columns]
                    
                    # Get row count
                    try:
                        row_count = conn.execute(f"""
                            SELECT COUNT(*) 
                            FROM "{schema_name}"."{table_name}"
                        """).fetchone()[0]
                    except:
                        row_count = 0
                    
                    schema_info['schemas'][schema_name]['tables'][table_name] = {
                        'columns': column_info,
                        'row_count': row_count
                    }
                    
                except Exception as e:
                    print(f"Error getting schema for {schema_name}.{table_name}: {e}")
                    continue
        
        return jsonify({
            'success': True,
            'data': schema_info
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400

@app.route('/api/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file part'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'error': 'No selected file'}), 400
    
    if file and file.filename.endswith('.csv'):
        try:
            # Save the file
            filename = f"{str(uuid.uuid4())}.csv"
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(filepath)
            
            # Get database, schema, and table name from form
            db_name = request.form.get('database', 'default')
            schema_name = request.form.get('schema', 'main')
            table_name = request.form.get('table')
            
            if not table_name:
                table_name = f'table_{int(datetime.now().timestamp())}'
            
            # Get database connection
            conn = get_connection(db_name)
            
            # Create schema if it doesn't exist and it's not 'main'
            if schema_name != 'main':
                conn.execute(f"CREATE SCHEMA IF NOT EXISTS {schema_name}")
            
            # Read CSV into a temporary table
            df = pd.read_csv(filepath)
            temp_table = f"temp_{str(uuid.uuid4()).replace('-', '_')}"
            conn.register(temp_table, df)
            
            # Create the target table in the specified schema
            full_table_name = f'"{schema_name}"."{table_name}"' if schema_name != 'main' else f'"{table_name}"'
            conn.execute(f"CREATE TABLE {full_table_name} AS SELECT * FROM {temp_table}")
            
            # Clean up
            conn.unregister(temp_table)
            os.remove(filepath)
            
            return jsonify({
                'success': True,
                'message': f'Successfully imported {file.filename} as {schema_name}.{table_name}'
            })
        except Exception as e:
            # Clean up in case of error
            if 'filepath' in locals() and os.path.exists(filepath):
                os.remove(filepath)
            if 'conn' in locals() and 'temp_table' in locals():
                try:
                    conn.unregister(temp_table)
                except:
                    pass
            
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    else:
        return jsonify({
            'success': False,
            'error': 'Only CSV files are supported'
        }), 400

@app.route('/api/databases', methods=['GET'])
def list_databases():
    try:
        # Get all .db files in the databases directory
        databases = set()
        if os.path.exists(app.config['DATABASE_FOLDER']):
            databases.update(
                f.replace('.db', '') 
                for f in os.listdir(app.config['DATABASE_FOLDER']) 
                if f.endswith('.db') and os.path.isfile(os.path.join(app.config['DATABASE_FOLDER'], f))
            )
        
        # Always include 'memory' and 'default' in the list
        databases.update(['memory', 'default'])
        
        # Get database sizes
        db_info = []
        for db in sorted(databases):
            db_path = get_db_path(db)
            size = os.path.getsize(db_path) if os.path.exists(db_path) else 0
            db_info.append({
                'name': db,
                'size': size,
                'active': db in connections
            })
        
        return jsonify({
            'success': True,
            'data': db_info
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    app.run(debug=True)

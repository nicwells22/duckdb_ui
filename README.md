# DuckDB Web UI

A user-friendly web interface for interacting with DuckDB databases. This application allows you to:
- Connect to and manage multiple DuckDB databases
- Execute SQL queries with syntax highlighting
- Browse database schemas
- Upload and import CSV files
- View query results with sortable tables

## 🚀 Quick Start

### Prerequisites
- Python 3.7 or higher
- pip (Python package manager)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/duckdb_ui.git
   cd duckdb_ui
   ```

2. **Create a virtual environment (recommended)**
   ```bash
   # On Windows
   python -m venv venv
   .\venv\Scripts\activate
   
   # On macOS/Linux
   python3 -m venv venv
   source venv/bin/activate
   ```

3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Run the application**
   ```bash
   python app.py
   ```

5. **Open your browser**
   Visit [http://localhost:5000](http://localhost:5000) to access the DuckDB Web UI.

## 🖥️ User Guide

### Connecting to a Database
1. The application automatically creates a default database when you first run it.
2. To connect to an existing DuckDB database, place the `.db` file in the `databases/` folder.
3. The database will be automatically detected and listed in the sidebar.

### Running Queries
1. Type your SQL query in the query editor
2. Click "Run Query" or press `Ctrl+Enter` to execute
3. View results in the table below
4. Use the "Explain" button to see the query execution plan

### Uploading Data
1. Click the "Upload" button in the sidebar
2. Select a CSV file to upload
3. Choose whether to create a new table or append to an existing one
4. Map columns to appropriate data types if needed

### Managing Databases
- View and manage all databases in the left sidebar
- Click on a database to make it active
- The active database is shown in the sidebar
- Right-click on tables to view options

## 🛠️ Development

### Project Structure
```
duckdb_ui/
├── app.py              # Main application file
├── requirements.txt    # Python dependencies
├── static/             # Static files (CSS, JS, images)
│   ├── css/
│   └── js/
├── templates/          # HTML templates
├── uploads/            # Uploaded files
└── databases/          # Database files
```

### Adding New Features
1. Fork the repository
2. Create a new branch for your feature
3. Make your changes
4. Submit a pull request

### Running Tests
```bash
# Install test dependencies
pip install -r requirements-dev.txt

# Run tests
pytest
```

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📊 Features

- **SQL Editor**: Write and execute SQL queries with syntax highlighting
- **Schema Browser**: Explore database structure in the left sidebar
- **Data Import**: Easily import CSV files into your database
- **Multiple Databases**: Connect to and manage multiple DuckDB databases
- **Responsive Design**: Works on desktop and tablet devices

## 🆘 Support

For support, please open an issue on the [GitHub repository](https://github.com/yourusername/duckdb_ui/issues).

## 📦 Dependencies

- Python 3.7+
- Flask
- DuckDB
- Pandas
- NumPy
- Flask-CORS
- python-dotenv

## 🔧 Troubleshooting

### Database Connection Issues
- Ensure the database file is not locked by another process
- Check file permissions for the `databases/` directory
- Verify the database file is a valid DuckDB database

### Upload Issues
- Check file size (max 16MB)
- Ensure CSV format is valid
- Verify column headers don't contain special characters

## 📈 Performance Tips

- For large databases, create appropriate indexes
- Use `LIMIT` when exploring data
- Close connections when not in use
- Consider using views for complex queries

---

Made with ❤️ by Nicholas Wells

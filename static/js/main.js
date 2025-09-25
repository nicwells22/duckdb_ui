// Global variables
let editor;
let currentDatabase = 'default';
let schemaData = {};
let currentTablePreview = null;
let databases = [];

// DOM Elements
const runQueryBtn = document.getElementById('run-query');
const formatQueryBtn = document.getElementById('format-query');
const clearQueryBtn = document.getElementById('clear-query');
const queryInfo = document.getElementById('query-info');
const resultsDiv = document.getElementById('results');
const schemaTree = document.getElementById('schema-tree');
const tablePreview = document.getElementById('table-preview');
const tablePreviewTitle = document.getElementById('table-preview-title');
const rowCount = document.getElementById('row-count');
const refreshExplorerBtn = document.getElementById('refresh-explorer');
const uploadForm = document.getElementById('upload-form');
const csvFileInput = document.getElementById('csv-file');
const tableNameInput = document.getElementById('table-name');
const importBtn = document.getElementById('import-btn');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const databaseList = document.getElementById('database-list');
const currentDbElement = document.getElementById('current-db');

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize modals with no backdrop
    const modalElement = document.getElementById('newDatabaseModal');
    if (modalElement) {
        new bootstrap.Modal(modalElement, {
            backdrop: false,  // This prevents the backdrop from appearing
            keyboard: true
        });
    }
    
    try {
        await initializeEditor();
        setupEventListeners();
        
        // Initialize tooltips
        const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
        tooltipTriggerList.map(function (tooltipTriggerEl) {
            return new bootstrap.Tooltip(tooltipTriggerEl);
        });
        
        // Load databases and restore the last used one if available
        await loadDatabases();
        
        // Try to restore the last used database from localStorage
        const lastDatabase = localStorage.getItem('lastDatabase');
        if (lastDatabase && databases.some(db => db.name === lastDatabase)) {
            await switchDatabase(lastDatabase);
        } else if (databases.length > 0) {
            // Default to the first database if no last used
            await switchDatabase(databases[0].name);
        } else {
            // No databases found, create a default one
            await switchDatabase('default');
        }
        
        // Load schema for the current database
        if (currentDatabase) {
            await loadSchema();
        }
        
        // Set initial active tab
        const queryTab = document.querySelector('[data-bs-target="#query-panel"]');
        if (queryTab) {
            queryTab.click();
        }
        
        // Initialize clipboard for copy buttons
        if (typeof ClipboardJS !== 'undefined') {
            new ClipboardJS('.btn-copy');
        }
    } catch (error) {
        console.error('Initialization error:', error);
        showError('Failed to initialize application: ' + error.message);
    }
});

// Initialize Monaco Editor
async function initializeEditor() {
    return new Promise((resolve, reject) => {
        // Check if Monaco is already loaded
        if (window.monaco) {
            createEditor();
            return;
        }

        // Load Monaco Editor
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.36.1/min/vs/loader.js';
        script.onload = () => {
            require.config({ 
                paths: { 
                    'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.36.1/min/vs',
                    'vs/language/sql/sql.worker': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.36.1/min/vs/language/sql/sql.worker.js'
                },
                'vs/nls': {
                    availableLanguages: { '*': 'en' }
                }
            });

            require(['vs/editor/editor.main'], () => {
                createEditor();
            }, (error) => {
                console.error('Failed to load Monaco Editor:', error);
                reject(new Error('Failed to load code editor. Please check your internet connection.'));
            });
        };
        script.onerror = () => {
            reject(new Error('Failed to load Monaco Editor. Please check your internet connection.'));
        };
        document.head.appendChild(script);

        function createEditor() {
            try {
                editor = monaco.editor.create(document.getElementById('editor'), {
                    value: '-- Enter your SQL query here\nSELECT * FROM ',
                    language: 'sql',
                    theme: 'vs-light',
                    automaticLayout: true,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    fontSize: 14,
                    lineNumbers: 'on',
                    roundedSelection: false,
                    scrollbar: {
                        vertical: 'auto',
                        horizontal: 'auto',
                        useShadows: true,
                        verticalHasArrows: false,
                        horizontalHasArrows: false,
                        verticalScrollbarSize: 12,
                        horizontalScrollbarSize: 12
                    },
                    tabSize: 2,
                    wordWrap: 'on',
                    renderWhitespace: 'selection',
                    formatOnPaste: true,
                    formatOnType: true,
                    suggestOnTriggerCharacters: true,
                    quickSuggestions: {
                        other: true,
                        comments: false,
                        strings: false
                    }
                });

                // Add keyboard shortcuts
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, executeQuery);
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                    // Save query (placeholder for future implementation)
                    showSuccess('Query saved (not implemented yet)');
                });

                // Setup SQL language features
                setupSQLLanguageFeatures();

                resolve();
            } catch (error) {
                console.error('Error initializing editor:', error);
                reject(error);
            }
        }
    });
}

// Setup SQL language features and autocompletion
function setupSQLLanguageFeatures() {
    // Add custom SQL completion provider
    monaco.languages.registerCompletionItemProvider('sql', {
        provideCompletionItems: (model, position) => {
            const textUntilPosition = model.getValueInRange({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: position.lineNumber,
                endColumn: position.column
            });

            const word = model.getWordUntilPosition(position);
            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn
            };

            // Get table and column suggestions from schema
            const suggestions = [];
            
            // Add table suggestions
            Object.entries(schemaData).forEach(([schemaName, schema]) => {
                if (schema.tables) {
                    Object.keys(schema.tables).forEach(tableName => {
                        suggestions.push({
                            label: tableName,
                            kind: monaco.languages.CompletionItemKind.Class,
                            detail: `Table in ${schemaName} schema`,
                            insertText: tableName,
                            range: range
                        });
                    });
                }
            });

            // Add SQL keywords
            const sqlKeywords = [
                'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'JOIN', 'LEFT JOIN', 'INNER JOIN',
                'RIGHT JOIN', 'FULL JOIN', 'UNION', 'UNION ALL', 'INSERT INTO', 'UPDATE', 'DELETE FROM', 'CREATE TABLE',
                'ALTER TABLE', 'DROP TABLE', 'CREATE VIEW', 'CREATE INDEX', 'PRAGMA', 'WITH', 'AS', 'ON', 'USING',
                'AND', 'OR', 'NOT', 'IN', 'BETWEEN', 'LIKE', 'IS NULL', 'IS NOT NULL', 'EXISTS', 'CASE', 'WHEN',
                'THEN', 'ELSE', 'END', 'DISTINCT', 'ALL', 'ANY', 'SOME', 'EXISTS', 'COUNT', 'SUM', 'AVG', 'MIN',
                'MAX', 'CAST', 'AS', 'ASC', 'DESC', 'LIMIT', 'OFFSET', 'FETCH', 'NEXT', 'ONLY'
            ];

            sqlKeywords.forEach(keyword => {
                suggestions.push({
                    label: keyword,
                    kind: monaco.languages.CompletionItemKind.Keyword,
                    insertText: keyword,
                    range: range
                });
            });

            return { suggestions };
        }
    });
}

// Set up event listeners
function setupEventListeners() {
    // New database form submission
    const newDbForm = document.getElementById('new-db-form');
    const createDbBtn = document.getElementById('create-db-btn');
    
    if (newDbForm) {
        // Handle form submission
        newDbForm.addEventListener('submit', (e) => {
            e.preventDefault();
            createNewDatabase();
        });
        
        // Also handle the create button click
        if (createDbBtn) {
            createDbBtn.addEventListener('click', (e) => {
                e.preventDefault();
                createNewDatabase();
            });
        }
    }
    
    // Refresh schema button
    const refreshSchemaBtn = document.getElementById('refresh-schema');
    if (refreshSchemaBtn) {
        refreshSchemaBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (currentDatabase) {
                await loadSchema();
                showSuccess('Schema refreshed');
            }
        });
    }
    
    // New database name input - allow Enter key to submit
    const newDbNameInput = document.getElementById('new-db-name');
    if (newDbNameInput) {
        newDbNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                createNewDatabase();
            }
        });
    }
    
    // Query execution
    if (runQueryBtn) {
        runQueryBtn.addEventListener('click', executeQuery);
    }
    
    // Query formatting
    if (formatQueryBtn) {
        formatQueryBtn.addEventListener('click', formatQuery);
    }
    
    // Clear query editor
    if (clearQueryBtn) {
        clearQueryBtn.addEventListener('click', () => {
            if (confirm('Clear the query editor? This cannot be undone.')) {
                editor.setValue('');
                clearResults();
            }
        });
    }
    
    // Refresh schema explorer
    if (refreshExplorerBtn) {
        refreshExplorerBtn.addEventListener('click', () => {
            loadSchema().catch(error => {
                console.error('Error refreshing schema:', error);
                showError('Failed to refresh schema: ' + error.message);
            });
        });
    }
    
    // Handle file uploads
    if (uploadForm) {
        uploadForm.addEventListener('submit', handleFileUpload);
    }
    
    // Auto-fill table name from file name
    if (csvFileInput) {
        csvFileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                const fileName = e.target.files[0].name;
                const tableName = fileName
                    .replace(/\.[^/.]+$/, '')
                    .replace(/[^a-zA-Z0-9_]/g, '_')
                    .toLowerCase()
                    .replace(/^_+|_+$/g, '');
                
                if (tableNameInput) {
                    tableNameInput.value = tableName;
                }
            }
        });
    }
    
    // Database switching and creation
    document.addEventListener('click', (e) => {
        const dbItem = e.target.closest('.db-item');
        const newDbBtn = e.target.closest('.new-db');
        
        if (dbItem) {
            e.preventDefault();
            const dbName = dbItem.getAttribute('data-db');
            if (dbName && dbName !== currentDatabase) {
                switchDatabase(dbName);
            }
        } else if (newDbBtn) {
            e.preventDefault();
            const modal = new bootstrap.Modal(document.getElementById('newDatabaseModal'));
            const dbNameInput = document.getElementById('new-db-name');
            if (dbNameInput) {
                dbNameInput.value = '';
                dbNameInput.focus();
            }
            modal.show();
        }
    });
    
    // Handle keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl+Enter to execute query (handled by Monaco)
        // Add other global shortcuts here if needed
    });
    
    // Handle window resize
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (editor) {
                editor.layout();
            }
        }, 250);
    });
}

// Format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Load available databases
async function loadDatabases() {
    try {
        const response = await fetch('/api/databases');
        const data = await response.json();
        if (data.success) {
            databases = data.data;
            updateDatabaseList();
        } else {
            showError('Failed to load databases');
        }
    } catch (error) {
        showError('Error loading databases: ' + error.message);
    }
}

// Update database list in UI
function updateDatabaseList() {
    const databaseList = document.getElementById('database-list');
    if (!databaseList) return;
    
    databaseList.innerHTML = '';
    
    // Sort databases alphabetically
    const sortedDbs = [...databases].sort((a, b) => a.name.localeCompare(b.name));

    sortedDbs.forEach(db => {
        const dbItem = document.createElement('a');
        dbItem.href = '#';
        dbItem.className = `list-group-item list-group-item-action d-flex justify-content-between align-items-center ${db.name === currentDatabase ? 'active' : ''}`;
        
        const dbName = document.createElement('span');
        dbName.className = 'd-flex align-items-center';
        dbName.textContent = db.name;
        
        // Add check icon for current database
        if (db.name === currentDatabase) {
            const checkIcon = document.createElement('i');
            checkIcon.className = 'bi bi-check-circle-fill ms-2';
            checkIcon.setAttribute('title', 'Current database');
            dbName.appendChild(checkIcon);
        }
        
        dbItem.appendChild(dbName);
        
        // Add row count badge if available
        if (db.row_count !== undefined) {
            const badge = document.createElement('span');
            badge.className = 'badge bg-secondary rounded-pill';
            badge.textContent = db.row_count.toLocaleString();
            dbItem.appendChild(badge);
        }
        
        // Add double-click handler for switching databases
        dbItem.addEventListener('dblclick', (e) => {
            e.preventDefault();
            if (db.name !== currentDatabase) {
                switchDatabase(db.name);
            }
        });
        
        // Prevent text selection on double-click
        dbItem.addEventListener('mousedown', (e) => {
            if (e.detail > 1) e.preventDefault();
        });
        
        databaseList.appendChild(dbItem);
    });
    
    // Update current database display
    const currentDbElement = document.getElementById('current-db');
    if (currentDbElement) {
        currentDbElement.textContent = currentDatabase;
    }
    
    // Update page title
    document.title = `${currentDatabase} - DuckDB UI`;
}

// Switch to a different database
async function switchDatabase(dbName) {
    if (dbName === currentDatabase) return;
    
    showLoading(`Switching to database: ${dbName}...`);
    const previousDb = currentDatabase;
    currentDatabase = dbName;
    
    try {
        // Update UI immediately for better responsiveness
        updateDatabaseList();
        
        // Load the schema for the new database
        await loadSchema();
        
        // Update the query editor with a basic query
        editor.setValue('-- Start typing your SQL query here\nSELECT * FROM ');
        
        // Clear any existing results
        clearResults();
        
        // Update schema list in sidebar
        updateSchemaList();
        
        // Show success message
        showSuccess(`Switched to database: ${dbName}`);
        
        // Save the current database to localStorage
        localStorage.setItem('lastDatabase', dbName);
        
    } catch (error) {
        // Revert to the previous database on error
        currentDatabase = previousDb;
        updateDatabaseList();
        showError(`Failed to switch to database '${dbName}': ${error.message}`);
    } finally {
        hideLoading();
    }
}

// Create a new database
async function createNewDatabase() {
    const dbNameInput = document.getElementById('new-db-name');
    const dbName = dbNameInput.value.trim();
    
    if (!dbName) {
        showError('Please enter a database name');
        dbNameInput.focus();
        return;
    }
    
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbName)) {
        showError('Invalid database name. Use only letters, numbers, and underscores, starting with a letter or underscore.');
        dbNameInput.focus();
        return;
    }
    
    // Check if database already exists
    if (databases.some(db => db.name.toLowerCase() === dbName.toLowerCase())) {
        showError(`A database named '${dbName}' already exists`);
        dbNameInput.focus();
        return;
    }
    
    const createBtn = document.getElementById('create-db-btn');
    const spinner = document.getElementById('create-db-spinner');
    
    try {
        // Show loading state
        createBtn.disabled = true;
        spinner.classList.remove('d-none');
        
        // Send request to create the database
        const response = await fetch('/api/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                database: dbName,
                query: 'SELECT 1'  // Simple query to create the database
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Close the modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('newDatabaseModal'));
            modal.hide();
            
            // Clear the input
            dbNameInput.value = '';
            
            // Reload the databases list to include the new one
            await loadDatabases();
            
            // Update the UI with the new database list
            updateDatabaseList();
            
            // Switch to the new database
            await switchDatabase(dbName);
            
            // Show success message
            showSuccess(`Database '${dbName}' created and selected`);
        } else {
            throw new Error(data.error || 'Failed to create database');
        }
    } catch (error) {
        console.error('Error creating database:', error);
        showError(`Failed to create database: ${error.message}`);
    } finally {
        // Reset button state
        createBtn.disabled = false;
        spinner.classList.add('d-none');
        
        // Ensure modal is properly hidden and backdrop is removed
        const modalElement = document.getElementById('newDatabaseModal');
        if (modalElement) {
            const modal = bootstrap.Modal.getInstance(modalElement);
            if (modal) {
                // Hide the modal
                modal.hide();
                
                // Manually remove the backdrop if it exists
                const backdrop = document.querySelector('.modal-backdrop');
                if (backdrop) {
                    backdrop.remove();
                }
                
                // Re-enable body scrolling
                document.body.style.overflow = '';
                document.body.style.paddingRight = '';
                
                // Remove the modal-open class from body
                document.body.classList.remove('modal-open');
            }
        }
    }
}

// Update schema list in the sidebar
function updateSchemaList() {
    const schemaList = document.getElementById('schema-list');
    if (!schemaList) return;
    
    if (!currentDatabase) {
        schemaList.innerHTML = `
            <div class="text-center p-3 text-muted">
                <i class="bi bi-database-x d-block mb-2" style="font-size: 1.5rem;"></i>
                <span>No database selected</span>
            </div>`;
        return;
    }
    
    if (!schemaData || !schemaData.schemas || Object.keys(schemaData.schemas).length === 0) {
        schemaList.innerHTML = `
            <div class="text-center p-3 text-muted">
                <i class="bi bi-database-x d-block mb-2" style="font-size: 1.5rem;"></i>
                <span>No schemas found</span>
            </div>`;
        return;
    }
    
    let html = '';
    
    // Sort schemas alphabetically
    const sortedSchemas = Object.entries(schemaData.schemas).sort(([a], [b]) => a.localeCompare(b));
    
    sortedSchemas.forEach(([schemaName, schema]) => {
        const schemaId = `sidebar-schema-${schemaName.replace(/[^a-zA-Z0-9-]/g, '-')}`;
        const hasTables = schema.tables && Object.keys(schema.tables).length > 0;
        
        html += `
            <div class="schema-item">
                <div class="d-flex justify-content-between align-items-center px-3 py-2 border-bottom" 
                     data-bs-toggle="collapse" 
                     data-bs-target="#${schemaId}">
                    <span class="fw-semibold">
                        <i class="bi bi-folder2 me-2"></i>${schemaName}
                    </span>
                    <i class="bi bi-chevron-down"></i>
                </div>
                <div class="collapse ${hasTables ? 'show' : ''} ms-3" id="${schemaId}">
                    ${renderSidebarTables(schemaName, schema.tables || {})}
                </div>
            </div>`;
    });
    
    schemaList.innerHTML = html || '<div class="text-muted p-3">No schemas found</div>';
    
    // Add event listeners for schema items
    document.querySelectorAll('.schema-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.table-item, .column-item')) return;
            const toggle = item.querySelector('[data-bs-toggle="collapse"]');
            if (toggle) {
                const target = document.querySelector(toggle.getAttribute('data-bs-target'));
                if (target) {
                    new bootstrap.Collapse(target, { toggle: true });
                    item.classList.toggle('collapsed');
                }
            }
        });
    });
}

// Render tables for the sidebar
function renderSidebarTables(schemaName, tables) {
    if (!tables || Object.keys(tables).length === 0) {
        return '<div class="text-muted small ms-3 my-1">No tables</div>';
    }
    
    // Sort tables alphabetically
    const sortedTables = Object.entries(tables).sort(([a], [b]) => a.localeCompare(b));
    
    return sortedTables.map(([tableName, table]) => {
        const tableId = `table-${schemaName}-${tableName}`.replace(/[^a-zA-Z0-9-]/g, '-');
        const rowCount = table.row_count ? `<span class="badge bg-secondary rounded-pill ms-2">${table.row_count.toLocaleString()}</span>` : '';
        
        return `
            <div class="table-item" data-schema="${schemaName}" data-table="${tableName}">
                <div class="d-flex justify-content-between align-items-center px-3 py-1" 
                     data-bs-toggle="collapse" 
                     data-bs-target="#${tableId}">
                    <span class="d-flex align-items-center">
                        <i class="bi bi-table me-2"></i>${tableName}
                    </span>
                    ${rowCount}
                </div>
                <div class="collapse ms-3" id="${tableId}">
                    ${renderSidebarColumns(table.columns || [])}
                </div>
            </div>`;
    }).join('');
}

// Render columns for the sidebar
function renderSidebarColumns(columns) {
    if (!columns || !Array.isArray(columns) || columns.length === 0) {
        return '<div class="text-muted small ms-3 my-1">No columns</div>';
    }
    
    return columns.map(column => {
        const typeInfo = column.type ? `<span class="text-muted small ms-2">${column.type}</span>` : '';
        return `
            <div class="column-item d-flex flex-column px-3 py-1 small" data-column="${column.name}">
                <div class="d-flex align-items-center">
                    <i class="bi bi-columns me-2 text-muted"></i>
                    <span class="font-monospace">${column.name}</span>
                    ${typeInfo}
                </div>
            </div>`;
    }).join('');
}

// Load database schema
async function loadSchema() {
    showLoading('Loading schema...');
    
    try {
        const response = await fetch(`/api/schema?database=${encodeURIComponent(currentDatabase)}`);
        const data = await response.json();
        
        if (data && data.success) {
            schemaData = data.data || {};
            // Only try to render schema tree if the element exists
            if (document.getElementById('schema-tree')) {
                renderSchemaTree();
            }
            updateSchemaList();
        } else {
            throw new Error(data?.error || 'Failed to load schema');
        }
    } catch (error) {
        console.error('Error loading schema:', error);
        if (schemaTree) {
            schemaTree.innerHTML = `
                <div class="alert alert-danger m-3" role="alert">
                    <i class="bi bi-exclamation-triangle-fill me-2"></i>
                    Failed to load schema: ${error.message}
                </div>`;
        }
    } finally {
        hideLoading();
    }
}

// Render schema tree
function renderSchemaTree() {
    if (!schemaData || !schemaData.schemas || Object.keys(schemaData.schemas).length === 0) {
        schemaTree.innerHTML = `
            <div class="text-center p-3 text-muted">
                <i class="bi bi-database-x d-block mb-2" style="font-size: 2rem;"></i>
                <p>No schemas found</p>
            </div>`;
        return;
    }
    
    let html = '';
    
    // Update current database display
    if (currentDbElement && schemaData.current_database) {
        currentDbElement.textContent = schemaData.current_database;
    }
    
    // Iterate through each schema
    for (const [schemaName, schema] of Object.entries(schemaData.schemas)) {
        const schemaId = `schema-${schemaName.replace(/[^a-zA-Z0-9-]/g, '-')}`;
        const hasTables = schema.tables && Object.keys(schema.tables).length > 0;
        
        html += `
            <div class="schema-item" data-schema="${schemaName}">
                <div class="d-flex justify-content-between align-items-center" data-bs-toggle="collapse" data-bs-target="#${schemaId}">
                    <span><i class="bi bi-folder2-open me-2"></i> ${schemaName}</span>
                    <i class="bi bi-chevron-down"></i>
                </div>
                <div class="collapse ${hasTables ? 'show' : ''} ms-3" id="${schemaId}">
                    ${renderTables(schemaName, schema.tables || {})}
                </div>
            </div>`;
    }
    
    schemaTree.innerHTML = html;
    
    // Add event listeners
    document.querySelectorAll('.schema-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.table-item, .column-item')) return;
            const toggle = item.querySelector('[data-bs-toggle="collapse"]');
            if (toggle) {
                const target = document.querySelector(toggle.getAttribute('data-bs-target'));
                if (target) {
                    new bootstrap.Collapse(target, { toggle: true });
                    item.classList.toggle('collapsed');
                }
            }
        });
    });
    
    document.querySelectorAll('.table-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const schema = item.getAttribute('data-schema');
            const table = item.getAttribute('data-table');
            previewTable(schema, table);
        });
    });
    
    document.querySelectorAll('.column-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const columnName = item.getAttribute('data-column');
            insertAtCursor(columnName);
        });
    });
}

// Render tables for a schema
function renderTables(schemaName, tables) {
    if (!tables || Object.keys(tables).length === 0) {
        return '<div class="text-muted small ms-3 my-1">No tables</div>';
    }
    
    return Object.entries(tables).map(([tableName, columns]) => {
        const tableId = `table-${schemaName}-${tableName}`.replace(/[^a-zA-Z0-9-]/g, '-');
        return `
            <div class="schema-item table-item" data-schema="${schemaName}" data-table="${tableName}">
                <div class="d-flex justify-content-between align-items-center" data-bs-toggle="collapse" data-bs-target="#${tableId}">
                    <span><i class="bi bi-table me-2"></i> ${tableName}</span>
                    <i class="bi bi-chevron-down"></i>
                </div>
                <div class="collapse ms-3" id="${tableId}">
                    ${renderColumns(columns)}
                </div>
            </div>`;
    }).join('');
}

// Render columns for a table
function renderColumns(columns) {
    if (!columns || !Array.isArray(columns) || columns.length === 0) {
        return '<div class="text-muted small ms-3 my-1">No columns</div>';
    }
    
    return columns.map(column => {
        const typeInfo = column.type ? ` <span class="text-muted small">${column.type}${column.nullable === false ? ' NOT NULL' : ''}${column.default !== null ? ` DEFAULT ${column.default}` : ''}</span>` : '';
        return `
            <div class="schema-item column-item d-flex flex-column px-2 py-1" data-column="${column.name}">
                <div class="d-flex align-items-center">
                    <i class="bi bi-columns me-2"></i>
                    <span class="font-monospace">${column.name}</span>
                </div>
                ${typeInfo}
            </div>`;
    }).join('');
}

// Preview table data
async function previewTable(schema, table) {
    showLoading(`Loading ${table}...`);
    
    try {
        const query = `SELECT * FROM ${schema ? `"${schema}".` : ''}"${table}" LIMIT 100`;
        const response = await fetch('/api/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                database: currentDatabase,
                query: query
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            renderTablePreview(table, data);
        } else {
            throw new Error(data.error || 'Failed to load table data');
        }
    } catch (error) {
        console.error('Error loading table data:', error);
        tablePreview.innerHTML = `
            <div class="alert alert-danger m-3" role="alert">
                <i class="bi bi-exclamation-triangle-fill me-2"></i>
                Failed to load table data: ${error.message}
            </div>`;
    } finally {
        hideLoading();
    }
}

// Render table preview
function renderTablePreview(tableName, data) {
    if (!data || !data.columns || !data.data) {
        tablePreview.innerHTML = '<div class="alert alert-warning m-3">No data available</div>';
        return;
    }
    
    const columns = data.columns;
    const rows = data.data;
    
    tablePreviewTitle.textContent = tableName;
    rowCount.textContent = `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`;
    
    let html = `
        <div class="table-responsive">
            <table class="table table-striped table-hover table-sm">
                <thead class="table-light">
                    <tr>
                        ${columns.map(col => `<th>${escapeHtml(col)}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
    `;
    
    rows.forEach(row => {
        html += '<tr>';
        columns.forEach(col => {
            let value = row[col];
            
            if (value === null || value === undefined) {
                value = '<span class="text-muted">NULL</span>';
            } else if (typeof value === 'object') {
                value = JSON.stringify(value);
            } else if (typeof value === 'boolean') {
                value = value ? '✓' : '✗';
            } else if (typeof value === 'string' && value.length > 100) {
                value = escapeHtml(value.substring(0, 100)) + '...';
            } else {
                value = escapeHtml(String(value));
            }
            
            html += `<td>${value}</td>`;
        });
        html += '</tr>';
    });
    
    html += '</tbody></table></div>';
    
    if (rows.length >= 100) {
        html += '<div class="text-muted small ms-2 mb-2">Showing first 100 rows</div>';
    }
    
    tablePreview.innerHTML = html;
    
    // Make table headers sortable
    const ths = tablePreview.querySelectorAll('th');
    ths.forEach((th, index) => {
        th.style.cursor = 'pointer';
        th.addEventListener('click', () => sortTable(th, index));
    });
}

// Execute SQL query
async function executeQuery() {
    const query = editor.getValue().trim();
    
    if (!query) {
        showError('Please enter a query');
        return;
    }
    
    // Show loading state
    showLoading('Executing query...');
    if (runQueryBtn) {
        runQueryBtn.disabled = true;
        runQueryBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span> Executing...';
    }
    
    try {
        const startTime = performance.now();
        
        // Execute the query
        const response = await fetch('/api/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                database: currentDatabase,
                query: query
            })
        });
        
        const endTime = performance.now();
        const executionTime = ((endTime - startTime) / 1000).toFixed(2);
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            renderQueryResults(data, executionTime);
            
            // If this is a schema-modifying query, refresh the schema
            if (isSchemaModifyingQuery(query)) {
                await loadSchema().catch(error => {
                    console.warn('Failed to refresh schema:', error);
                });
            }
            
            // Show success message for non-SELECT queries
            if (!query.trim().toUpperCase().startsWith('SELECT')) {
                const affectedRows = data.affectedRows || data.rowCount || 0;
                const message = data.message || `Query executed successfully in ${executionTime}s`;
                showSuccess(`${message} (${affectedRows} ${affectedRows === 1 ? 'row' : 'rows'} affected)`);
            }
        } else {
            throw new Error(data.error || 'Query execution failed');
        }
    } catch (error) {
        console.error('Query error:', error);
        
        // Try to extract more detailed error information
        let errorMessage = error.message;
        if (error.response) {
            try {
                const errorData = await error.response.json();
                errorMessage = errorData.error || error.message;
            } catch (e) {
                // If we can't parse the error response, use the status text
                errorMessage = `${error.response.status} ${error.response.statusText}`;
            }
        }
        
        // Display the error in the results area
        if (resultsDiv) {
            resultsDiv.innerHTML = `
                <div class="alert alert-danger" role="alert">
                    <h5 class="alert-heading">Query Error</h5>
                    <p>${escapeHtml(errorMessage)}</p>
                    <hr>
                    <p class="mb-0">Check the browser console for more details.</p>
                </div>`;
        }
        
        // Show error toast
        showError('Query failed: ' + errorMessage);
    } finally {
        hideLoading();
        if (runQueryBtn) {
            runQueryBtn.disabled = false;
            runQueryBtn.innerHTML = '<i class="bi bi-play-fill me-1"></i> Run';
        }
    }
}

// Check if query modifies schema
function isSchemaModifyingQuery(query) {
    const normalizedQuery = query.trim().toUpperCase();
    return (
        normalizedQuery.startsWith('CREATE ') ||
        normalizedQuery.startsWith('ALTER ') ||
        normalizedQuery.startsWith('DROP ') ||
        normalizedQuery.startsWith('INSERT ') ||
        normalizedQuery.startsWith('UPDATE ') ||
        normalizedQuery.startsWith('DELETE ')
    );
}

// Render query results
function renderQueryResults(data, executionTime) {
    if (!data || !data.data || data.data.length === 0) {
        queryInfo.innerHTML = `Query executed in ${executionTime}s. No results.`;
        resultsDiv.innerHTML = '<div class="alert alert-info m-0">Query executed successfully. No results returned.</div>';
        return;
    }
    
    const columns = data.columns || [];
    const rows = data.data || [];
    
    queryInfo.innerHTML = `Query executed in ${executionTime}s. ${rows.length} ${rows.length === 1 ? 'row' : 'rows'} returned.`;
    
    let html = `
        <div class="table-responsive">
            <table class="table table-striped table-hover table-sm">
                <thead class="table-light">
                    <tr>
                        ${columns.map(col => `<th>${escapeHtml(col)}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
    `;
    
    rows.forEach(row => {
        html += '<tr>';
        columns.forEach(col => {
            let value = row[col];
            
            if (value === null || value === undefined) {
                value = '<span class="text-muted">NULL</span>';
            } else if (typeof value === 'object') {
                value = JSON.stringify(value);
            } else if (typeof value === 'boolean') {
                value = value ? '✓' : '✗';
            } else if (typeof value === 'string' && value.length > 100) {
                value = escapeHtml(value.substring(0, 100)) + '...';
            } else {
                value = escapeHtml(String(value));
            }
            
            html += `<td>${value}</td>`;
        });
        html += '</tr>';
    });
    
    html += '</tbody></table></div>';
    
    if (rows.length >= 1000) {
        html += '<div class="text-muted small ms-2 mb-2">Results limited to 1000 rows</div>';
    }
    
    resultsDiv.innerHTML = html;
    
    // Make table headers sortable
    const ths = resultsDiv.querySelectorAll('th');
    ths.forEach((th, index) => {
        th.style.cursor = 'pointer';
        th.addEventListener('click', () => sortTable(th, index));
    });
}

// Clear query results
function clearResults() {
    resultsDiv.innerHTML = `
        <div class="text-center text-muted">
            <i class="bi bi-arrow-return-left d-block mb-2" style="font-size: 2rem;"></i>
            <p>Enter a query and click "Run" or press Ctrl+Enter to see results</p>
        </div>`;
    queryInfo.textContent = '';
}

// Format SQL query
function formatQuery() {
    // This is a simple formatter
    let query = editor.getValue();
    
    // Basic formatting (simplified)
    query = query
        .replace(/\b(SELECT|FROM|WHERE|GROUP BY|HAVING|ORDER BY|LIMIT|OFFSET|JOIN|INNER JOIN|LEFT JOIN|RIGHT JOIN|FULL JOIN|CROSS JOIN|UNION|UNION ALL|INTERSECT|EXCEPT|INSERT INTO|UPDATE|DELETE FROM|CREATE TABLE|ALTER TABLE|DROP TABLE|CREATE VIEW|CREATE INDEX|PRAGMA)\b/gi, '\n$1')
        .replace(/\b(AND|OR|ON|SET|VALUES|DISTINCT|AS|IN|BETWEEN|LIKE|IS NULL|IS NOT NULL|ASC|DESC|PRIMARY KEY|FOREIGN KEY|REFERENCES|CONSTRAINT|DEFAULT|AUTOINCREMENT|NOT NULL|UNIQUE|CHECK|DEFAULT|INDEX|TO|DATABASE|SCHEMA|TABLE|VIEW|SEQUENCE|FUNCTION|PROCEDURE|TRIGGER|CASCADE|RESTRICT|NO ACTION|SET NULL|SET DEFAULT|DEFERRABLE|INITIALLY DEFERRED|INITIALLY IMMEDIATE|MATCH FULL|MATCH PARTIAL|MATCH SIMPLE|DEFERRED|IMMEDIATE|TRANSACTION|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|EXPLAIN|ANALYZE|VACUUM|PRAGMA|WITH|RECURSIVE|WINDOW|RANGE|ROWS|GROUPS|PRECEDING|FOLLOWING|CURRENT ROW|UNBOUNDED|PARTITION BY|OVER|FILTER|LATERAL|NATURAL|USING|ONLY|RETURNING|WITH ORDINALITY|TABLESAMPLE|REPLACE|IF EXISTS|IF NOT EXISTS|TEMPORARY|TEMP|GLOBAL|LOCAL|PRESERVE ROWS|WITHOUT ROWID|STRICT|WITHOUT TIME ZONE|WITH TIME ZONE|GENERATED ALWAYS|STORED|VIRTUAL|SYSTEM TIME|APPLY|PIVOT|UNPIVOT|MATCH_RECOGNIZE|MEASURES|DEFINE|PATTERN|SUBSET|PER|ALL|ANY|SOME|EXISTS|UNIQUE|DISTINCT|OVERLAPS|SIMILAR TO|SIMILAR|ESCAPE|BETWEEN SYMMETRIC|IS DISTINCT FROM|IS NOT DISTINCT FROM|IS TRUE|IS NOT TRUE|IS FALSE|IS NOT FALSE|IS UNKNOWN|IS NOT UNKNOWN|IS NULL|IS NOT NULL|IS NORMALIZED|IS NOT NORMALIZED|IS JSON|IS NOT JSON|IS DOCUMENT|IS NOT DOCUMENT|IS OF|IS NOT OF|IS A SET|IS NOT A SET|IS EMPTY|IS NOT EMPTY|IS ATOMIC|IS NOT ATOMIC|IS A|IS NOT A|IS OF TYPE|IS NOT OF TYPE|IS JSON VALUE|IS NOT JSON VALUE|IS JSON OBJECT|IS NOT JSON OBJECT|IS JSON ARRAY|IS NOT JSON ARRAY|IS JSON SCALAR|IS NOT JSON SCALAR|IS JSON WITH UNIQUE KEYS|IS NOT JSON WITH UNIQUE KEYS|IS JSON WITHOUT UNIQUE KEYS|IS NOT JSON WITHOUT UNIQUE KEYS)\b/gi, '\n    $1')
        .trim();
    
    editor.setValue(query);
}

// Handle file upload
async function handleFileUpload(e) {
    e.preventDefault();
    
    if (!uploadForm || !csvFileInput || !tableNameInput) {
        showError('Form elements not found');
        return;
    }
    
    const file = csvFileInput.files[0];
    let tableName = tableNameInput.value.trim();
    let schemaName = 'main'; // Default schema
    
    if (!file) {
        showError('Please select a file to upload');
        return;
    }
    
    if (!tableName) {
        showError('Please enter a table name');
        return;
    }
    
    // Check if table name contains a schema (e.g., 'schema.table')
    if (tableName.includes('.')) {
        const parts = tableName.split('.');
        if (parts.length !== 2) {
            showError('Invalid table name format. Use either "table_name" or "schema_name.table_name"');
            return;
        }
        schemaName = parts[0].trim();
        tableName = parts[1].trim();
        
        if (!schemaName) {
            showError('Schema name cannot be empty');
            return;
        }
    }
    
    // Validate schema name (alphanumeric and underscores only)
    if (!/^[a-zA-Z_]\w*$/.test(schemaName)) {
        showError('Schema name must start with a letter or underscore and contain only letters, numbers, or underscores');
        return;
    }
    
    // Validate table name (alphanumeric and underscores only)
    if (!/^[a-zA-Z_]\w*$/.test(tableName)) {
        showError('Table name must start with a letter or underscore and contain only letters, numbers, or underscores');
        return;
    }
    
    const formData = new FormData(uploadForm);
    formData.append('database', currentDatabase);
    formData.append('schema', schemaName);
    formData.append('table', tableName);
    
    // Show loading state
    showLoading(`Importing ${file.name}...`);
    const importBtn = document.getElementById('import-btn');
    if (importBtn) {
        importBtn.disabled = true;
        importBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span> Importing...';
    }
    
    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Upload failed with status ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            const displayName = schemaName === 'main' ? tableName : `${schemaName}.${tableName}`;
            showSuccess(`Successfully imported ${file.name} as ${displayName}`);
            
            // Reset form
            uploadForm.reset();
            
            // Refresh schema to show the new table
            await loadSchema();
            
            // Auto-generate and execute a SELECT query to show the imported data
            const fullTableName = schemaName === 'main' ? `"${tableName}"` : `"${schemaName}"."${tableName}"`;
            const selectQuery = `SELECT * FROM ${fullTableName} LIMIT 100;`;
            editor.setValue(selectQuery);
            
            // Switch to the query tab
            const queryTab = document.querySelector('[data-bs-target="#query-panel"]');
            if (queryTab) {
                queryTab.click();
            }
            
            // Execute the query after a short delay to allow UI to update
            setTimeout(executeQuery, 100);
        } else {
            throw new Error(data.error || 'Import failed');
        }
    } catch (error) {
        console.error('Import error:', error);
        
        // Try to extract more detailed error information
        let errorMessage = error.message;
        if (error.response) {
            try {
                const errorData = await error.response.json();
                errorMessage = errorData.error || error.message;
            } catch (e) {
                // If we can't parse the error response, use the status text
                errorMessage = `${error.response.status} ${error.response.statusText}`;
            }
        }
        
        showError('Import failed: ' + errorMessage);
    } finally {
        hideLoading();
        if (importBtn) {
            importBtn.disabled = false;
            importBtn.innerHTML = '<i class="bi bi-upload me-1"></i> Import';
        }
    }
}

// Sort table by column
function sortTable(th, colIndex) {
    const table = th.closest('table');
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));
    
    const isNumeric = rows.every(row => {
        const cell = row.cells[colIndex];
        const text = cell.textContent.trim();
        return text === '' || !isNaN(text);
    });
    
    const isAsc = !th.classList.contains('sorted-asc');
    th.classList.toggle('sorted-asc', isAsc);
    th.classList.toggle('sorted-desc', !isAsc);
    
    th.parentElement.querySelectorAll('th').forEach((h, i) => {
        if (i !== colIndex) {
            h.classList.remove('sorted-asc', 'sorted-desc');
        }
    });
    
    rows.sort((a, b) => {
        const aCell = a.cells[colIndex];
        const bCell = b.cells[colIndex];
        
        let aValue = aCell.textContent.trim();
        let bValue = bCell.textContent.trim();
        
        if (aValue === 'NULL') aValue = null;
        if (bValue === 'NULL') bValue = null;
        
        if (aValue === null && bValue === null) return 0;
        if (aValue === null) return isAsc ? 1 : -1;
        if (bValue === null) return isAsc ? -1 : 1;
        
        if (isNumeric) {
            const aNum = parseFloat(aValue);
            const bNum = parseFloat(bValue);
            return isAsc ? aNum - bNum : bNum - aNum;
        } else {
            return isAsc 
                ? aValue.localeCompare(bValue, undefined, { numeric: true })
                : bValue.localeCompare(aValue, undefined, { numeric: true });
        }
    });
    
    tbody.innerHTML = '';
    rows.forEach(row => tbody.appendChild(row));
}

// Insert text at cursor position
function insertAtCursor(text) {
    const selection = editor.getSelection();
    const range = new monaco.Range(
        selection.startLineNumber,
        selection.startColumn,
        selection.endLineNumber,
        selection.endColumn
    );
    
    const id = { major: 1, minor: 1 };
    const op = {
        identifier: id,
        range: range,
        text: text,
        forceMoveMarkers: true
    };
    
    editor.executeEdits('insert-text', [op]);
    editor.focus();
}

// Loading overlay functions disabled
function showLoading() {
    // No-op - loading overlay disabled
    console.log('Loading... (overlay disabled)');
}

function hideLoading() {
    // No-op - loading overlay disabled
    console.log('Loading complete (overlay disabled)');
}

// Show success message with toast notification
function showSuccess(message) {
    // Create toast container if it doesn't exist
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.style.position = 'fixed';
        toastContainer.style.top = '20px';
        toastContainer.style.right = '20px';
        toastContainer.style.zIndex = '1100';
        toastContainer.style.maxWidth = '350px';
        document.body.appendChild(toastContainer);
    }
    
    // Create toast element
    const toastId = 'toast-' + Date.now();
    const toast = document.createElement('div');
    toast.id = toastId;
    toast.className = 'toast show align-items-center text-white bg-success border-0 mb-2';
    toast.role = 'alert';
    toast.setAttribute('aria-live', 'assertive');
    toast.setAttribute('aria-atomic', 'true');
    
    // Add animation classes
    toast.style.transition = 'opacity 0.3s ease-in-out';
    
    // Create toast content
    toast.innerHTML = `
        <div class="d-flex">
            <div class="toast-body d-flex align-items-center">
                <i class="bi bi-check-circle-fill me-2"></i>
                <span>${escapeHtml(message)}</span>
            </div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
    `;
    
    // Add close button handler
    const closeBtn = toast.querySelector('[data-bs-dismiss="toast"]');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            hideToast(toast);
        });
    }
    
    // Add to container
    toastContainer.appendChild(toast);
    
    // Auto-hide after delay
    const autoHideDelay = 5000; // 5 seconds
    const hideTimeout = setTimeout(() => {
        hideToast(toast);
    }, autoHideDelay);
    
    // Pause auto-hide on hover
    toast.addEventListener('mouseenter', () => {
        clearTimeout(hideTimeout);
    });
    
    // Resume auto-hide when mouse leaves
    toast.addEventListener('mouseleave', () => {
        clearTimeout(hideTimeout);
        setTimeout(() => {
            hideToast(toast);
        }, 2000); // Shorter delay after hover
    });
    
    // Function to hide toast with animation
    function hideToast(toastElement) {
        if (!toastElement) return;
        
        toastElement.style.opacity = '0';
        
        // Remove from DOM after animation
        setTimeout(() => {
            if (toastElement && toastElement.parentNode) {
                toastElement.parentNode.removeChild(toastElement);
            }
            
            // Remove container if empty
            if (toastContainer && toastContainer.children.length === 0) {
                document.body.removeChild(toastContainer);
            }
        }, 300);
    }
}

// Show error message with toast notification
function showError(message) {
    // Create toast container if it doesn't exist
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.style.position = 'fixed';
        toastContainer.style.top = '20px';
        toastContainer.style.right = '20px';
        toastContainer.style.zIndex = '1100';
        toastContainer.style.maxWidth = '350px';
        document.body.appendChild(toastContainer);
    }
    
    // Create toast element
    const toastId = 'toast-' + Date.now();
    const toast = document.createElement('div');
    toast.id = toastId;
    toast.className = 'toast show align-items-center text-white bg-danger border-0 mb-2';
    toast.role = 'alert';
    toast.setAttribute('aria-live', 'assertive');
    toast.setAttribute('aria-atomic', 'true');
    
    // Add animation classes
    toast.style.transition = 'opacity 0.3s ease-in-out';
    
    // Truncate long messages
    const maxLength = 200;
    const displayMessage = message.length > maxLength 
        ? message.substring(0, maxLength) + '...' 
        : message;
    
    // Create toast content
    toast.innerHTML = `
        <div class="d-flex">
            <div class="toast-body d-flex align-items-center">
                <i class="bi bi-exclamation-triangle-fill me-2"></i>
                <span>${escapeHtml(displayMessage)}</span>
            </div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
    `;
    
    // Add click handler to show full message in console
    toast.querySelector('.toast-body').addEventListener('click', () => {
        console.error('Full error message:', message);
    });
    
    // Add close button handler
    const closeBtn = toast.querySelector('[data-bs-dismiss="toast"]');
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            hideToast(toast);
        });
    }
    
    // Add to container
    toastContainer.appendChild(toast);
    
    // Auto-hide after delay (longer for errors)
    const autoHideDelay = 8000; // 8 seconds
    const hideTimeout = setTimeout(() => {
        hideToast(toast);
    }, autoHideDelay);
    
    // Pause auto-hide on hover
    toast.addEventListener('mouseenter', () => {
        clearTimeout(hideTimeout);
    });
    
    // Resume auto-hide when mouse leaves
    toast.addEventListener('mouseleave', () => {
        clearTimeout(hideTimeout);
        setTimeout(() => {
            hideToast(toast);
        }, 3000); // Shorter delay after hover
    });
    
    // Function to hide toast with animation
    function hideToast(toastElement) {
        if (!toastElement) return;
        
        toastElement.style.opacity = '0';
        
        // Remove from DOM after animation
        setTimeout(() => {
            if (toastElement && toastElement.parentNode) {
                toastElement.parentNode.removeChild(toastElement);
            }
            
            // Remove container if empty
            if (toastContainer && toastContainer.children.length === 0) {
                document.body.removeChild(toastContainer);
            }
        }, 300);
    }
    
    // Log the error to console
    console.error('Error:', message);
}

// Escape HTML special characters to prevent XSS
function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) {
        return '';
    }
    
    return String(unsafe)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/\n/g, '<br>') // Preserve line breaks
        .replace(/\t/g, '    '); // Convert tabs to spaces
}

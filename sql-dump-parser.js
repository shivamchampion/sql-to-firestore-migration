// robust-sql-dump-parser.js - Advanced SQL dump parser with diagnostics
const fs = require('fs').promises;
const path = require('path');

// Configuration
const CONFIG = {
  sqlDumpFile: './u485278146_backup.sql',  // Path to your SQL dump file
  outputDir: './exported-sql-data',        // Directory to save JSON output
  diagnosticsFile: './sql-parse-diagnostics.log', // File to save detailed diagnostics
  verbose: true,                           // Enable verbose logging
  logInsertStatements: true,              // Log found INSERT statements to help debugging
  tables: [
    'users',
    'plans',
    'plan_features',
    'cities',
    'states',
    'industries',
    'sub_industries',
    'businesses',
    'business_media',
    'franchise',
    'franchise_media',
    'franchise_formats',
    'franchise_locations',
    'investors',
    'investor_sub_industries',
    'investor_location_preference',
    'user_plans',
    'userchat',
    'userchat_msg',
    'chat_files'
  ]
};

// Main parsing function
async function parseSqlDump() {
  console.log(`Reading SQL dump file: ${CONFIG.sqlDumpFile}`);
  
  // Diagnostics log
  let diagnostics = `SQL DUMP PARSE DIAGNOSTICS\n`;
  diagnostics += `==========================\n`;
  diagnostics += `File: ${CONFIG.sqlDumpFile}\n`;
  diagnostics += `Date: ${new Date().toISOString()}\n\n`;
  
  try {
    // Read the SQL dump file
    const sqlContent = await fs.readFile(CONFIG.sqlDumpFile, 'utf8');
    console.log(`Loaded SQL file: ${(sqlContent.length / 1024 / 1024).toFixed(2)} MB`);
    
    diagnostics += `File size: ${(sqlContent.length / 1024 / 1024).toFixed(2)} MB\n\n`;
    diagnostics += `TABLE SCHEMAS\n`;
    diagnostics += `============\n`;
    
    // Extract table schemas and data
    const tables = {};
    
    // Process each table
    for (const tableName of CONFIG.tables) {
      // Extract table schema first
      const tableSchema = extractTableSchema(sqlContent, tableName);
      
      if (tableSchema && tableSchema.columns.length > 0) {
        tables[tableName] = {
          columns: tableSchema.columns,
          data: []
        };
        
        console.log(`Found schema for table ${tableName} with ${tableSchema.columns.length} columns`);
        diagnostics += `Table: ${tableName}\n`;
        diagnostics += `Columns: ${tableSchema.columns.join(', ')}\n\n`;
      } else {
        console.log(`Could not find schema for table: ${tableName}`);
        diagnostics += `Table: ${tableName}\n`;
        diagnostics += `ERROR: Could not extract schema\n\n`;
        continue;
      }
    }
    
    diagnostics += `\nINSERT STATEMENTS\n`;
    diagnostics += `================\n`;
    
    // Now extract data for each table using multiple INSERT patterns
    for (const tableName of Object.keys(tables)) {
      // Try multiple INSERT statement patterns
      const insertPatterns = [
        // Standard VALUES pattern with multiple rows
        `INSERT\\s+INTO\\s+\`${tableName}\`\\s*(?:\\([^)]+\\))?\\s*VALUES\\s*([\\s\\S]*?);`,
        // Pattern with column names explicitly specified
        `INSERT\\s+INTO\\s+\`${tableName}\`\\s*\\([^)]+\\)\\s*VALUES\\s*([\\s\\S]*?);`,
        // Pattern for single-row inserts (common in dumps)
        `INSERT\\s+INTO\\s+\`${tableName}\`\\s*VALUES\\s*\\(([^;]+?)\\);`,
        // Pattern with newlines between values
        `INSERT\\s+INTO\\s+\`${tableName}\`[\\s\\S]*?VALUES[\\s\\S]*?\\(([\\s\\S]*?)\\);`
      ];
      
      let dataFound = false;
      let allInsertStatements = [];
      
      // Collect all INSERT statements for this table
      const regex = new RegExp(`INSERT\\s+INTO\\s+\`${tableName}\`[\\s\\S]*?;`, 'gi');
      let match;
      
      while ((match = regex.exec(sqlContent)) !== null) {
        allInsertStatements.push(match[0]);
      }
      
      if (CONFIG.logInsertStatements) {
        diagnostics += `Table: ${tableName}\n`;
        diagnostics += `Found ${allInsertStatements.length} INSERT statements\n`;
        
        if (allInsertStatements.length > 0) {
          allInsertStatements.forEach((stmt, idx) => {
            diagnostics += `Statement ${idx + 1}: ${stmt.length > 200 ? stmt.substring(0, 200) + '...' : stmt}\n`;
          });
        }
        diagnostics += '\n';
      }
      
      // Try direct extraction first
      for (const pattern of insertPatterns) {
        const data = extractTableData(sqlContent, pattern, tables[tableName].columns);
        if (data.length > 0) {
          tables[tableName].data = data;
          dataFound = true;
          console.log(`Found ${data.length} rows for table ${tableName} using pattern: ${pattern.substring(0, 50)}...`);
          break;
        }
      }
      
      // If direct extraction failed, try processing each INSERT statement individually
      if (!dataFound && allInsertStatements.length > 0) {
        const data = [];
        
        for (const statement of allInsertStatements) {
          try {
            // Extract values part from the INSERT statement
            const valuesMatch = statement.match(/VALUES\s*\((.*)\)/i);
            if (valuesMatch && valuesMatch[1]) {
              const values = parseValuesComplex(valuesMatch[1]);
              
              if (values.length > 0 && values.length <= tables[tableName].columns.length) {
                const rowData = {};
                for (let i = 0; i < values.length; i++) {
                  rowData[tables[tableName].columns[i]] = values[i];
                }
                data.push(rowData);
              }
            }
          } catch (error) {
            diagnostics += `Error parsing INSERT statement for ${tableName}: ${error.message}\n`;
          }
        }
        
        if (data.length > 0) {
          tables[tableName].data = data;
          dataFound = true;
          console.log(`Found ${data.length} rows for table ${tableName} by processing individual INSERT statements`);
        }
      }
      
      if (!dataFound) {
        console.log(`No data found for table ${tableName}`);
        diagnostics += `No data rows extracted for table ${tableName}\n\n`;
      } else {
        diagnostics += `Extracted ${tables[tableName].data.length} rows for table ${tableName}\n\n`;
      }
    }
    
    // Save diagnostics
    await fs.writeFile(CONFIG.diagnosticsFile, diagnostics, 'utf8');
    console.log(`Saved diagnostics to ${CONFIG.diagnosticsFile}`);
    
    // Save extracted data to JSON files
    await ensureDirectoryExists(CONFIG.outputDir);
    
    for (const tableName of Object.keys(tables)) {
      const outputPath = path.join(CONFIG.outputDir, `${tableName}.json`);
      await fs.writeFile(outputPath, JSON.stringify(tables[tableName].data, null, 2), 'utf8');
      console.log(`Saved ${tables[tableName].data.length} rows to ${outputPath}`);
    }
    
    console.log('\nSQL dump parsing completed!');
    console.log(`Files saved to: ${path.resolve(CONFIG.outputDir)}`);
    
  } catch (error) {
    console.error('Error parsing SQL dump:', error);
    diagnostics += `\nERROR PARSING SQL DUMP: ${error.message}\n`;
    diagnostics += `${error.stack}\n`;
    await fs.writeFile(CONFIG.diagnosticsFile, diagnostics, 'utf8');
  }
}

// Extract table schema (column names) from SQL dump
function extractTableSchema(sqlContent, tableName) {
  // Look for CREATE TABLE statement for this table
  const createTableRegex = new RegExp(`CREATE TABLE\\s+\`${tableName}\`\\s*\\(([\\s\\S]*?)\\)\\s*ENGINE`, 'i');
  const match = sqlContent.match(createTableRegex);
  
  if (!match) {
    console.log(`No CREATE TABLE statement found for ${tableName}`);
    return null;
  }
  
  const tableDefinition = match[1];
  const columns = [];
  
  // Extract column names from table definition
  // This regex is designed to match column definitions in various formats
  const columnRegex = /`(\w+)`\s+(?:[^,]+)(?:,|$)/g;
  let columnMatch;
  
  while ((columnMatch = columnRegex.exec(tableDefinition)) !== null) {
    columns.push(columnMatch[1]);
  }
  
  return { columns };
}

// Extract data for a specific table using a given regex pattern
function extractTableData(sqlContent, pattern, columns) {
  const data = [];
  const insertRegex = new RegExp(pattern, 'ig');
  
  let insertMatch;
  while ((insertMatch = insertRegex.exec(sqlContent)) !== null) {
    const valuesText = insertMatch[1];
    
    if (!valuesText) {
      continue;
    }
    
    // Try to handle multi-row inserts
    const rows = splitInsertValues(valuesText);
    
    for (let rowText of rows) {
      try {
        // Remove outer parentheses if they exist
        rowText = rowText.trim();
        if (rowText.startsWith('(') && rowText.endsWith(')')) {
          rowText = rowText.substring(1, rowText.length - 1);
        }
        
        // Parse values from the row
        const values = parseValuesComplex(rowText);
        
        // Create object from column names and values
        if (values.length > 0 && values.length <= columns.length) {
          const rowData = {};
          for (let i = 0; i < values.length; i++) {
            rowData[columns[i]] = values[i];
          }
          data.push(rowData);
        }
      } catch (error) {
        if (CONFIG.verbose) {
          console.error(`Error parsing row: ${rowText.substring(0, 100)}..., Error: ${error.message}`);
        }
      }
    }
  }
  
  return data;
}

// More robust splitting of INSERT VALUES text
function splitInsertValues(valuesText) {
  // Handle the single-row case
  if (!valuesText.includes('),(')) {
    return [valuesText.trim()];
  }
  
  // Handle multi-row inserts
  const result = [];
  let current = '';
  let depth = 0;
  let inString = false;
  let stringChar = null;
  let escaped = false;
  
  for (let i = 0; i < valuesText.length; i++) {
    const char = valuesText[i];
    
    // Handle string literals
    if ((char === "'" || char === '"') && !escaped) {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
        stringChar = null;
      }
    }
    
    // Handle escape character
    if (char === '\\' && !escaped) {
      escaped = true;
      current += char;
      continue;
    } else {
      escaped = false;
    }
    
    // Handle parentheses
    if (char === '(' && !inString) {
      depth++;
    } else if (char === ')' && !inString) {
      depth--;
    }
    
    // Add character to current row
    current += char;
    
    // Check for row separator ('),(' pattern outside of strings)
    if (depth === 0 && !inString && 
        char === ')' && 
        i + 1 < valuesText.length && valuesText[i + 1] === ',' && 
        i + 2 < valuesText.length && valuesText[i + 2] === '(') {
      result.push(current);
      current = '';
      i += 2; // Skip the comma and opening parenthesis
    }
  }
  
  // Add the last row if there's anything left
  if (current) {
    result.push(current);
  }
  
  // If no rows were found, treat the whole string as one row
  if (result.length === 0 && valuesText.trim()) {
    result.push(valuesText.trim());
  }
  
  return result;
}

// State machine-based value parsing for complex SQL values
function parseValuesComplex(rowText) {
  const values = [];
  let currentValue = '';
  let inString = false;
  let stringChar = null;
  let escaped = false;
  
  for (let i = 0; i < rowText.length; i++) {
    const char = rowText[i];
    
    // Handle escape sequence
    if (escaped) {
      currentValue += char;
      escaped = false;
      continue;
    }
    
    // Start of escape sequence
    if (char === '\\') {
      escaped = true;
      continue;
    }
    
    // Handle string delimiters
    if ((char === "'" || char === '"') && !escaped) {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
        stringChar = null;
      } else {
        currentValue += char; // This is a different quote inside a string
      }
      continue;
    }
    
    // Handle value delimiter (comma outside of string)
    if (char === ',' && !inString) {
      values.push(processValue(currentValue.trim()));
      currentValue = '';
      continue;
    }
    
    // Add the character to the current value
    currentValue += char;
  }
  
  // Add the last value
  if (currentValue.trim() !== '') {
    values.push(processValue(currentValue.trim()));
  }
  
  return values;
}

// Process a single value to convert SQL types to JavaScript types
function processValue(value) {
  // Handle NULL values
  if (value.toUpperCase() === 'NULL') {
    return null;
  }
  
  // Handle quoted strings
  if ((value.startsWith("'") && value.endsWith("'")) || 
      (value.startsWith('"') && value.endsWith('"'))) {
    // Remove quotes and unescape special characters
    let unquoted = value.substring(1, value.length - 1);
    unquoted = unquoted.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    return unquoted;
  }
  
  // Handle numbers
  if (!isNaN(value) && value !== '') {
    // Check if it's an integer or float
    if (value.includes('.')) {
      return parseFloat(value);
    } else {
      return parseInt(value, 10);
    }
  }
  
  // Default case
  return value;
}

// Ensure directory exists, create if not
async function ensureDirectoryExists(dirPath) {
  try {
    await fs.access(dirPath);
  } catch (error) {
    console.log(`Creating directory: ${dirPath}`);
    await fs.mkdir(dirPath, { recursive: true });
  }
}

// Run the parser
parseSqlDump();
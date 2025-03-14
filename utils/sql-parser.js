/**
 * SQL Parser to extract data from SQL dump file
 */
const fs = require('fs');
const readline = require('readline');
const logger = require('./logger');

/**
 * Parse SQL file and extract table data
 * @param {string} filePath - Path to SQL dump file
 * @returns {Promise<Object>} - Object containing tables and their data
 */
async function parseSQLFile(filePath) {
  const tablesData = {};
  let currentTable = null;
  let collectingInsert = false;
  let insertStatement = '';
  let columnNames = [];

  // Create a readline interface to process the file line by line
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  // Process the file line by line
  for await (const line of rl) {
    // Skip comments and empty lines
    if (line.startsWith('--') || line.startsWith('/*') || line.trim() === '') {
      continue;
    }

    // Check for CREATE TABLE statement
    if (line.includes('CREATE TABLE')) {
      const tableMatch = line.match(/CREATE TABLE\s+`(\w+)`/);
      if (tableMatch) {
        currentTable = tableMatch[1];
        tablesData[currentTable] = [];
      }
      continue;
    }

    // Start collecting INSERT statements
    if (line.includes('INSERT INTO') && currentTable) {
      collectingInsert = true;
      insertStatement = line;
      
      // Extract column names if present in the INSERT statement
      const columnMatch = line.match(/INSERT INTO\s+`\w+`\s+\(([^)]+)\)/);
      if (columnMatch) {
        columnNames = columnMatch[1].split(',').map(col => {
          return col.trim().replace(/`/g, '');
        });
      }
      
      // If the INSERT statement is complete, process it
      if (line.endsWith(';')) {
        processInsertStatement(insertStatement, currentTable, columnNames, tablesData);
        collectingInsert = false;
        insertStatement = '';
      }
      continue;
    }

    // Continue collecting multi-line INSERT statement
    if (collectingInsert) {
      insertStatement += ' ' + line;
      
      // If the INSERT statement is complete, process it
      if (line.endsWith(';')) {
        processInsertStatement(insertStatement, currentTable, columnNames, tablesData);
        collectingInsert = false;
        insertStatement = '';
      }
    }
  }

  logger.info(`Parsed ${Object.keys(tablesData).length} tables from SQL file`);
  return tablesData;
}

/**
 * Process an INSERT statement and extract data
 * @param {string} insertStatement - The SQL INSERT statement
 * @param {string} tableName - The current table name
 * @param {Array<string>} columnNames - Column names for the table
 * @param {Object} tablesData - Object to store the extracted data
 */
function processInsertStatement(insertStatement, tableName, columnNames, tablesData) {
  // Extract values from INSERT statement
  const valuesMatch = insertStatement.match(/VALUES\s+(\([^;]+)/i);
  if (!valuesMatch) return;

  let valuesStr = valuesMatch[1];
  // Remove trailing comma and semicolon
  valuesStr = valuesStr.replace(/,\s*;?$/, '');

  // Split values into rows (handling proper parsing of values with commas in them)
  const rows = [];
  let current = '';
  let parenthesisLevel = 0;
  let inString = false;
  
  for (let i = 0; i < valuesStr.length; i++) {
    const char = valuesStr[i];
    
    // Handle string literals
    if (char === "'" && (i === 0 || valuesStr[i-1] !== '\\')) {
      inString = !inString;
    }
    
    // Track parenthesis level
    if (char === '(' && !inString) {
      parenthesisLevel++;
      if (parenthesisLevel === 1) {
        current = '';
        continue;
      }
    } else if (char === ')' && !inString) {
      parenthesisLevel--;
      if (parenthesisLevel === 0) {
        rows.push(current);
        continue;
      }
    }
    
    // Track row separation
    if (char === ',' && parenthesisLevel === 0 && !inString) {
      continue;
    }
    
    // Add character to current value
    if (parenthesisLevel > 0) {
      current += char;
    }
  }

  // Process each row
  for (const row of rows) {
    const rowValues = parseRowValues(row);
    
    if (rowValues.length > 0) {
      // If we have column names, create an object with column names as keys
      if (columnNames.length > 0) {
        const rowObject = {};
        for (let i = 0; i < Math.min(columnNames.length, rowValues.length); i++) {
          rowObject[columnNames[i]] = rowValues[i];
        }
        tablesData[tableName].push(rowObject);
      } else {
        // Otherwise, just add the array of values
        tablesData[tableName].push(rowValues);
      }
    }
  }
}

/**
 * Parse values from a row in an INSERT statement
 * @param {string} rowStr - String containing row values
 * @returns {Array<any>} - Array of parsed values
 */
function parseRowValues(rowStr) {
  const values = [];
  let current = '';
  let inString = false;
  
  for (let i = 0; i < rowStr.length; i++) {
    const char = rowStr[i];
    
    // Handle string literals
    if (char === "'" && (i === 0 || rowStr[i-1] !== '\\')) {
      inString = !inString;
      current += char;
      continue;
    }
    
    // Handle value separation
    if (char === ',' && !inString) {
      values.push(parseValue(current.trim()));
      current = '';
      continue;
    }
    
    // Add character to current value
    current += char;
  }
  
  // Add the last value
  if (current.trim()) {
    values.push(parseValue(current.trim()));
  }
  
  return values;
}

/**
 * Parse a single value from the SQL data
 * @param {string} valueStr - The string representation of the value
 * @returns {any} - Parsed value (string, number, boolean, null)
 */
function parseValue(valueStr) {
  // Handle NULL values
  if (valueStr.toUpperCase() === 'NULL') {
    return null;
  }
  
  // Handle string values
  if (valueStr.startsWith("'") && valueStr.endsWith("'")) {
    return valueStr.substring(1, valueStr.length - 1).replace(/\\'/g, "'");
  }
  
  // Handle numeric values
  if (!isNaN(valueStr)) {
    return Number(valueStr);
  }
  
  // Handle boolean values
  if (valueStr.toUpperCase() === 'TRUE') return true;
  if (valueStr.toUpperCase() === 'FALSE') return false;
  
  // Default to returning the string as is
  return valueStr;
}

module.exports = {
  parseSQLFile
};
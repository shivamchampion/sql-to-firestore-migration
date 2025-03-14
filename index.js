/**
 * Main entry point for SQL to Firestore migration
 * Orchestrates the entire migration process
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const { initializeFirestore } = require('./utils/firestore-service');
const { parseSQLFile } = require('./utils/sql-parser');
const { getCollectionConfig } = require('./config/mapping-config');

// Import all migration modules
const usersMigration = require('./migrations/users-migration');
const listingsMigration = require('./migrations/listings-migration');
const plansMigration = require('./migrations/plans-migration');
const reviewsMigration = require('./migrations/reviews-migration');
const subscriptionsMigration = require('./migrations/subscriptions-migration');
const transactionsMigration = require('./migrations/transactions-migration');
const messagesMigration = require('./migrations/messages-migration');
const chatroomsMigration = require('./migrations/chatrooms-migration');

// Migration collection mapping
const migrations = {
  users: usersMigration,
  listings: listingsMigration,
  plans: plansMigration,
  reviews: reviewsMigration,
  subscriptions: subscriptionsMigration,
  transactions: transactionsMigration,
  messages: messagesMigration,
  chatrooms: chatroomsMigration
};

// Define the migration order to respect dependencies
const MIGRATION_ORDER = [
  'users',
  'plans',
  'listings',
  'reviews',
  'subscriptions',
  'transactions',
  'chatrooms',
  'messages'
];

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
  .option('collection', {
    alias: 'c',
    description: 'Specify collection to migrate',
    type: 'string'
  })
  .option('all', {
    alias: 'a',
    description: 'Migrate all collections',
    type: 'boolean'
  })
  .option('dryRun', {
    alias: 'd',
    description: 'Run migration without writing to Firestore',
    type: 'boolean',
    default: false
  })
  .option('limit', {
    alias: 'l',
    description: 'Limit number of documents to migrate per collection',
    type: 'number'
  })
  .help()
  .alias('help', 'h')
  .argv;

// Simple colored console functions without chalk
const colorLog = {
  red: (text) => console.error(`\x1b[31m${text}\x1b[0m`),
  green: (text) => console.log(`\x1b[32m${text}\x1b[0m`),
  yellow: (text) => console.log(`\x1b[33m${text}\x1b[0m`),
  blue: (text) => console.log(`\x1b[34m${text}\x1b[0m`)
};

// Simple logger
const logger = {
  info: (message) => {
    console.log(`[INFO] ${message}`);
    // Also write to log file if needed
  },
  warn: (message) => {
    console.log(`[WARN] ${message}`);
  },
  error: (message) => {
    console.error(`[ERROR] ${message}`);
  },
  success: (message) => {
    console.log(`[SUCCESS] ${message}`);
  }
};

// Main migration function
async function runMigration() {
  try {
    colorLog.blue('=== SQL to Firestore Migration Tool ===');
    logger.info('Starting migration process');
    
    // Initialize Firestore
    const db = initializeFirestore();
    
    // Check if SQL file exists
    const sqlFilePath = path.join(__dirname, 'data', 'u485278146_backup.sql');
    if (!fs.existsSync(sqlFilePath)) {
      throw new Error(`SQL file not found at ${sqlFilePath}`);
    }
    
    // Parse SQL file into tables data
    logger.info('Parsing SQL file...');
    const tablesData = await parseSQLFile(sqlFilePath);
    logger.info(`Parsed ${Object.keys(tablesData).length} tables from SQL file`);
    
    // Determine which collections to migrate
    let collectionsToMigrate = [];
    if (argv.all) {
      collectionsToMigrate = MIGRATION_ORDER;
    } else if (argv.collection) {
      if (!migrations[argv.collection]) {
        throw new Error(`Invalid collection: ${argv.collection}`);
      }
      collectionsToMigrate = [argv.collection];
    } else {
      collectionsToMigrate = MIGRATION_ORDER;
    }

    colorLog.yellow(`Will migrate the following collections: ${collectionsToMigrate.join(', ')}`);
    if (argv.dryRun) {
      colorLog.yellow('DRY RUN MODE: No data will be written to Firestore');
    }
    
    // Run migrations in the specified order
    for (const collectionName of collectionsToMigrate) {
      const migration = migrations[collectionName];
      const config = getCollectionConfig(collectionName);
      
      colorLog.green(`\nMigrating ${collectionName}...`);
      
      try {
        // Prepare the required tables data for this migration
        const requiredTables = config.requiredTables || [];
        const migrationData = {};
        
        for (const table of requiredTables) {
          if (!tablesData[table]) {
            logger.warn(`Required table "${table}" not found in SQL data`);
            migrationData[table] = [];
          } else {
            migrationData[table] = tablesData[table];
          }
        }
        
        // Apply document limit if specified
        const limit = argv.limit || null;
        
        // Run the migration
        const result = await migration.migrate(db, migrationData, { 
          dryRun: argv.dryRun,
          limit
        });
        
        colorLog.green(`✓ Successfully migrated ${result.count} ${collectionName} documents`);
        logger.info(`Migrated ${result.count} ${collectionName} documents`);
      } catch (error) {
        colorLog.red(`✗ Error migrating ${collectionName}: ${error.message}`);
        logger.error(`Error migrating ${collectionName}: ${error.message}`);
        if (error.stack) {
          logger.error(error.stack);
        }
      }
    }
    
    colorLog.blue('\n=== Migration Complete ===');
    logger.info('Migration process completed');
    
  } catch (error) {
    colorLog.red(`Migration failed: ${error.message}`);
    logger.error(`Migration failed: ${error.message}`);
    if (error.stack) {
      logger.error(error.stack);
    }
    process.exit(1);
  }
}

// Run the migration
runMigration();
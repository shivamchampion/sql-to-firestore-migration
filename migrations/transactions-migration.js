/**
 * Enhanced migration module for transactions collection
 * Handles financial transactions with robust validation
 */
const _ = require('lodash');
const { getOrCreateUUID, getUUID } = require('../utils/uuid-mapper');
const { processBatch } = require('../utils/batch-processor');
const MigrationStrategy = require('../utils/migration-strategy');
const MigrationTransformer = require('../utils/migration-transformer');
const ValidationConfig = require('../utils/migration-validation-config');
const logger = require('../utils/logger');

/**
 * Migrate transactions from SQL to Firestore with enhanced data quality
 * @param {FirebaseFirestore.Firestore} db - Firestore instance
 * @param {Object} data - SQL data containing transaction-related tables
 * @param {Object} options - Migration options
 * @returns {Promise<Object>} - Migration result
 */
async function migrate(db, data, options = {}) {
  logger.info('Starting enhanced transactions migration');
  
  try {
    // Extract all relevant tables from data
    const { 
      invoice = [], 
      payment = [], 
      users = [], 
      user_plans = [],
      plans = []
    } = data;
    
    // Step 1: Merge invoice and payment data for comprehensive transactions
    logger.info('Preparing transaction data...');
    const mergedTransactions = mergeTransactionSources(invoice, payment);
    
    // Step 2: Apply limit if specified
    const transactionsToMigrate = options.limit 
      ? mergedTransactions.slice(0, options.limit) 
      : mergedTransactions;
    
    // Step 3: Process transactions in batches
    logger.info(`Processing ${transactionsToMigrate.length} transactions...`);
    
    const result = await processBatch(
      transactionsToMigrate,
      async (transaction) => transformTransaction(transaction, { 
        users, 
        user_plans,
        plans 
      }),
      {
        collection: 'transactions',
        dryRun: options.dryRun,
        label: 'Migrating transactions',
        batchSize: 100,
        showProgress: true
      }
    );
    
    logger.info(`Enhanced transactions migration completed: ${result.processedCount} transactions processed with ${result.errors.length} errors`);
    
    return {
      collection: 'transactions',
      count: result.processedCount,
      errors: result.errors
    };
  } catch (error) {
    logger.error(`Fatal error in transactions migration: ${error.message}`);
    if (error.stack) {
      logger.error(error.stack);
    }
    
    return {
      collection: 'transactions',
      count: 0,
      errors: [{ error: error.message }]
    };
  }
}

/**
 * Merge invoice and payment data for comprehensive transaction records
 * @param {Array<Object>} invoices - Invoice records
 * @param {Array<Object>} payments - Payment records
 * @returns {Array<Object>} - Merged transaction records
 */
function mergeTransactionSources(invoices, payments) {
  // First, convert all invoices to transactions
  const transactions = invoices.map(invoice => ({
    ...invoice,
    source: 'invoice',
    paymentData: null
  }));
  
  // Create a map of order IDs for quick lookup
  const orderIdMap = {};
  transactions.forEach((transaction, index) => {
    if (transaction.order_id) {
      orderIdMap[transaction.order_id] = index;
    }
  });
  
  // Then, find and merge payment data where available
  payments.forEach(payment => {
    const orderIdMatches = payment.txnid && orderIdMap[payment.txnid] !== undefined;
    
    if (orderIdMatches) {
      // Merge with existing transaction
      const index = orderIdMap[payment.txnid];
      transactions[index].paymentData = payment;
    } else {
      // Create new transaction from payment
      transactions.push({
        id: payment.id,
        user_id: 0, // Unknown user
        type_id: 0,
        order_id: payment.txnid || `payment_${payment.id}`,
        user_plan_id: 0,
        transaction_id: payment.payuMoneyId || '',
        type: 'payment',
        amount: payment.amount,
        date_time: payment.order_date,
        payment_status: payment.status,
        source: 'payment',
        paymentData: payment
      });
    }
  });
  
  return transactions;
}

/**
 * Enhanced transform function for transactions
 * @param {Object} transaction - Transaction data from SQL
 * @param {Object} relatedData - Related data for transformation
 * @returns {Object} - Transformed transaction for Firestore
 */
async function transformTransaction(transaction, relatedData) {
  try {
    // Step 1: Generate UUID for the transaction
    const transactionId = getOrCreateUUID('transactions', transaction.id);
    
    // Step 2: Extract related entities
    const { users = [], user_plans = [], plans = [] } = relatedData;
    
    // Get user
    const userId = MigrationTransformer.number(transaction.user_id);
    const userUUID = getUUID('users', userId);
    const user = users.find(u => u.id === userId);
    
    // Get user plan
    const planId = MigrationTransformer.number(transaction.user_plan_id);
    const userPlan = user_plans.find(up => up.id === planId);
    
    // Get plan details
    let planUUID = null;
    let planName = '';
    let planType = '';
    
    if (userPlan) {
      planUUID = getUUID('plans', userPlan.plan_id);
      const plan = plans.find(p => p.id === userPlan.plan_id);
      
      if (plan) {
        planName = plan.name || '';
        planType = plan.plan_type || '';
      }
    }
    
    // Get listing details
    const listingId = MigrationTransformer.number(transaction.type_id);
    const listingUUID = getUUID('listings', listingId);
    
    // Get transaction status
    let status = 'pending';
    if (transaction.payment_status) {
      const statusLower = String(transaction.payment_status).toLowerCase();
      
      if (['completed', 'success', 'successful'].includes(statusLower)) {
        status = 'completed';
      } else if (['failed', 'failure'].includes(statusLower)) {
        status = 'failed';
      } else if (['refunded'].includes(statusLower)) {
        status = 'refunded';
      }
    }
    
    // Get payment details from merged payment data
    const paymentData = transaction.paymentData || {};
    
    // Parse amount with proper validation
    const amount = MigrationTransformer.number(transaction.amount, {
      parseString: true,
      defaultValue: 0
    });
    
    // Step 3: Build transformed transaction
    const transformedTransaction = {
      id: transactionId,
      userId: userUUID,
      
      // Transaction details
      type: determineTransactionType(transaction, userPlan),
      amount: amount,
      currency: 'INR',
      status: status,
      
      // Related entities
      subscription: {
        id: getUUID('subscriptions', transaction.user_plan_id) || null,
        planId: planUUID,
        planName: planName,
        planType: planType
      },
      listing: {
        id: listingUUID,
        name: transaction.type_name || '',
        type: getListingTypeFromContext(transaction)
      },
      
      // Payment details
      payment: {
        method: paymentData.mode || 'online',
        gateway: 'razorpay',
        gatewayTransactionId: transaction.transaction_id || paymentData.payuMoneyId || '',
        invoiceId: transaction.order_id || '',
        paymentDate: MigrationTransformer.date(transaction.date_time || paymentData.order_date) || new Date(),
        cardLastFour: extractCardLastFour(paymentData),
        upiId: extractUpiId(paymentData)
      },
      
      // Billing information
      billingInfo: {
        name: user ? user.full_name || `${user.f_name || ''} ${user.l_name || ''}`.trim() : '',
        email: user ? user.email : (paymentData.email || ''),
        phone: user ? user.mobile : '',
        address: {
          line1: user ? user.address : '',
          line2: '',
          city: user ? user.city_name : '',
          state: user ? user.state : '',
          postalCode: user ? user.pincode : '',
          country: 'India'
        },
        gstNumber: ''
      },
      
      // Receipt & invoice
      receipt: {
        number: transaction.order_id || '',
        url: '',
        generatedAt: MigrationTransformer.date(transaction.date_time) || new Date()
      },
      
      // Additional information
      metadata: {
        notes: '',
        promoCode: '',
        discount: 0,
        deviceInfo: '',
        ipAddress: ''
      },
      
      // Timestamps
      createdAt: MigrationTransformer.date(transaction.date_time) || new Date(),
      updatedAt: MigrationTransformer.date(transaction.date_time) || new Date(),
      completedAt: status === 'completed' ? 
        (MigrationTransformer.date(transaction.date_time) || new Date()) : 
        null,
      refundedAt: status === 'refunded' ? 
        (MigrationTransformer.date(transaction.date_time) || new Date()) : 
        null,
      isDeleted: false
    };
    
    // Step 4: Apply additional enhancements
    enhanceTransactionData(transformedTransaction);
    
    // Return the transformed transaction with document ID for Firestore
    return {
      docId: transactionId,
      data: transformedTransaction
    };
  } catch (error) {
    // Log error and return null to skip this transaction
    logger.error(`Error transforming transaction ${transaction.id}: ${error.message}`);
    if (error.stack) {
      logger.error(error.stack);
    }
    
    return null;
  }
}

/**
 * Determine transaction type from context
 * @param {Object} transaction - Transaction data
 * @param {Object} userPlan - User plan data
 * @returns {string} - Transaction type
 */
function determineTransactionType(transaction, userPlan) {
  if (transaction.type && typeof transaction.type === 'string') {
    const typeLower = transaction.type.toLowerCase();
    
    if (typeLower.includes('subscription') || typeLower.includes('plan')) {
      return 'subscription';
    } else if (typeLower.includes('connect') || typeLower.includes('message')) {
      return 'connect_purchase';
    } else if (typeLower.includes('refund')) {
      return 'refund';
    } else if (typeLower.includes('promotion') || typeLower.includes('feature')) {
      return 'listing_promotion';
    }
  }
  
  // Infer from context
  if (transaction.user_plan_id && userPlan) {
    return 'subscription';
  } else if (transaction.source === 'payment') {
    return 'payment';
  }
  
  return 'subscription'; // Default
}

/**
 * Determine listing type from transaction context
 * @param {Object} transaction - Transaction data
 * @returns {string} - Listing type
 */
function getListingTypeFromContext(transaction) {
  if (transaction.type_name) {
    const typeName = transaction.type_name.toLowerCase();
    
    if (typeName.includes('business')) {
      return 'business';
    } else if (typeName.includes('franchise')) {
      return 'franchise';
    } else if (typeName.includes('investor')) {
      return 'investor';
    } else if (typeName.includes('startup')) {
      return 'startup';
    } else if (typeName.includes('digital')) {
      return 'digital_asset';
    }
  }
  
  return '';
}

/**
 * Extract last four digits of card from payment data
 * @param {Object} paymentData - Payment data
 * @returns {string} - Last four digits or empty string
 */
function extractCardLastFour(paymentData) {
  if (!paymentData || !paymentData.mode) {
    return '';
  }
  
  // Look for card number in various fields
  const potentialFields = ['card_no', 'cardno', 'card_number', 'cardnumber'];
  for (const field of potentialFields) {
    if (paymentData[field] && typeof paymentData[field] === 'string') {
      const cardNumber = paymentData[field].replace(/[^0-9]/g, '');
      if (cardNumber.length >= 4) {
        return cardNumber.slice(-4);
      }
    }
  }
  
  return '';
}

/**
 * Extract UPI ID from payment data
 * @param {Object} paymentData - Payment data
 * @returns {string} - UPI ID or empty string
 */
function extractUpiId(paymentData) {
  if (!paymentData || !paymentData.mode) {
    return '';
  }
  
  // Look for UPI ID in various fields
  const potentialFields = ['upi_id', 'upiid', 'vpa'];
  for (const field of potentialFields) {
    if (paymentData[field] && typeof paymentData[field] === 'string') {
      return paymentData[field];
    }
  }
  
  return '';
}

/**
 * Enhance transaction data with additional improvements
 * @param {Object} transaction - Transformed transaction data
 */
function enhanceTransactionData(transaction) {
  // Format amount nicely
  if (transaction.amount) {
    // Create display amount for better readability
    transaction.displayAmount = {
      value: transaction.amount,
      formatted: `₹${transaction.amount.toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}`
    };
  }
  
  // Add tax information if missing
  if (!transaction.tax) {
    // Assume 18% GST for India
    const taxAmount = Math.round((transaction.amount * 0.18) * 100) / 100;
    
    transaction.tax = {
      taxableAmount: transaction.amount - taxAmount,
      taxAmount: taxAmount,
      taxRate: 18,
      taxName: 'GST',
      taxIncluded: true
    };
  }
  
  // Ensure receipt number format
  if (transaction.receipt && transaction.receipt.number) {
    const receiptNumber = transaction.receipt.number;
    
    // Format as INV-YYYYMMDD-XXXX if not already formatted
    if (!receiptNumber.startsWith('INV-')) {
      const date = transaction.createdAt;
      const dateStr = date 
        ? `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
        : 'YYYYMMDD';
      
      transaction.receipt.number = `INV-${dateStr}-${receiptNumber.slice(-4).padStart(4, '0')}`;
    }
  }
  
  // Enhance metadata with tags for easier querying
  if (!transaction.metadata.tags) {
    transaction.metadata.tags = [];
    
    // Add type tag
    transaction.metadata.tags.push(transaction.type);
    
    // Add status tag
    transaction.metadata.tags.push(transaction.status);
    
    // Add plan tag if available
    if (transaction.subscription && transaction.subscription.planType) {
      transaction.metadata.tags.push(transaction.subscription.planType);
    }
  }
  
  // Clean up any undefined values in top-level fields
  Object.keys(transaction).forEach(key => {
    if (transaction[key] === undefined) {
      transaction[key] = null;
    }
  });
}

module.exports = {
  migrate
};
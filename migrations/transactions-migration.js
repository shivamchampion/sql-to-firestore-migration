/**
 * Migration module for transactions collection
 */
const { getOrCreateUUID, getUUID } = require('../utils/uuid-mapper');
const { processBatch } = require('../utils/batch-processor');
const { DEFAULTS } = require('../config/migration-config');
const logger = require('../utils/logger');

/**
 * Migrate transactions from SQL to Firestore
 * @param {FirebaseFirestore.Firestore} db - Firestore instance
 * @param {Object} data - SQL data containing invoice, payment and users tables
 * @param {Object} options - Migration options
 * @returns {Promise<Object>} - Migration result
 */
async function migrate(db, data, options = {}) {
  logger.info('Starting transactions migration');
  
  const { invoice = [], payment = [], users = [], user_plans = [] } = data;
  
  // Merge invoice and payment data for comprehensive transactions
  const transactionsToProcess = mergeInvoiceAndPayment(invoice, payment);
  
  // Apply limit if specified
  const transactionsToMigrate = options.limit ? transactionsToProcess.slice(0, options.limit) : transactionsToProcess;
  
  // Process transactions in batches
  const result = await processBatch(
    transactionsToMigrate,
    async (transaction) => transformTransaction(transaction, { users, user_plans }),
    {
      collection: 'transactions',
      dryRun: options.dryRun,
      label: 'Migrating transactions',
      batchSize: 100
    }
  );
  
  logger.info(`Transactions migration completed: ${result.processedCount} transactions processed`);
  
  return {
    collection: 'transactions',
    count: result.processedCount,
    errors: result.errors
  };
}

/**
 * Merge invoice and payment data for comprehensive transactions
 * @param {Array<Object>} invoices - Invoice records
 * @param {Array<Object>} payments - Payment records
 * @returns {Array<Object>} - Merged transaction records
 */
function mergeInvoiceAndPayment(invoices, payments) {
  // First, convert all invoices to transactions
  const transactions = invoices.map(invoice => ({
    ...invoice,
    source: 'invoice',
    paymentData: null
  }));
  
  // Then, find and merge payment data where available
  for (let i = 0; i < transactions.length; i++) {
    const transaction = transactions[i];
    const payment = payments.find(p => p.txnid === transaction.order_id);
    
    if (payment) {
      transaction.paymentData = payment;
    }
  }
  
  // Also include any payments that don't have a corresponding invoice
  for (const payment of payments) {
    const exists = transactions.some(t => t.order_id === payment.txnid);
    
    if (!exists) {
      transactions.push({
        id: payment.id,
        user_id: 0, // Unknown user
        type_id: 0,
        order_id: payment.txnid,
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
  }
  
  return transactions;
}

/**
 * Transform SQL transaction to Firestore transaction document
 * @param {Object} transaction - SQL transaction record
 * @param {Object} relatedData - Related data (users, user_plans)
 * @returns {Object} - Firestore document operation
 */
function transformTransaction(transaction, relatedData) {
  const { users = [], user_plans = [] } = relatedData;
  
  // Generate a UUID for the transaction
  const transactionId = getOrCreateUUID('transactions', transaction.id);
  
  // Get referenced entities
  const userId = getUUID('users', transaction.user_id);
  
  // Find related user plan
  const userPlan = user_plans.find(up => up.id === transaction.user_plan_id);
  const planId = userPlan ? getUUID('plans', userPlan.plan_id) : null;
  
  // Find user details
  const user = users.find(u => u.id === transaction.user_id);
  
  // Get transaction status
  let status = 'pending';
  if (transaction.payment_status) {
    switch (transaction.payment_status.toLowerCase()) {
      case 'completed':
      case 'success':
      case 'successful':
        status = 'completed';
        break;
      case 'failed':
      case 'failure':
        status = 'failed';
        break;
      case 'refunded':
        status = 'refunded';
        break;
      default:
        status = 'pending';
    }
  }
  
  // Get payment details from merged payment data
  const paymentData = transaction.paymentData || {};
  
  // Parse amount
  let amount = 0;
  if (transaction.amount) {
    if (typeof transaction.amount === 'number') {
      amount = transaction.amount;
    } else {
      // Remove non-numeric characters except decimal point
      const amountStr = transaction.amount.toString().replace(/[^0-9.]/g, '');
      amount = parseFloat(amountStr) || 0;
    }
  }
  
  // Transform transaction data to match Firestore schema
  const firestoreTransaction = {
    id: transactionId,
    userId: userId,
    
    // Transaction details
    type: transaction.type || 'subscription',
    amount: amount,
    currency: 'INR',
    status: status,
    
    // Related entities
    subscription: {
      id: getUUID('subscriptions', transaction.user_plan_id) || null,
      planId: planId,
      planName: ''
    },
    listing: {
      id: getUUID('listings', transaction.type_id) || null,
      name: transaction.type_name || ''
    },
    
    // Payment details
    payment: {
      method: paymentData.mode || 'online',
      gateway: 'razorpay',
      gatewayTransactionId: transaction.transaction_id || paymentData.payuMoneyId || '',
      invoiceId: transaction.order_id || '',
      paymentDate: transaction.date_time || paymentData.order_date || DEFAULTS.CREATED_AT,
      cardLastFour: '',
      upiId: ''
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
      generatedAt: transaction.date_time || DEFAULTS.CREATED_AT
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
    createdAt: transaction.date_time || DEFAULTS.CREATED_AT,
    updatedAt: transaction.date_time || DEFAULTS.CREATED_AT,
    completedAt: status === 'completed' ? (transaction.date_time || DEFAULTS.CREATED_AT) : null,
    refundedAt: status === 'refunded' ? (transaction.date_time || DEFAULTS.CREATED_AT) : null,
    isDeleted: false
  };
  
  return {
    docId: transactionId,
    data: firestoreTransaction
  };
}

module.exports = {
  migrate
};
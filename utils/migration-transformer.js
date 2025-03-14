/**
 * Advanced migration transformer utility
 * Provides robust data transformation, validation, and type conversion
 */
const moment = require('moment');
const _ = require('lodash');
const { v4: uuidv4, v5: uuidv5 } = require('uuid');
const logger = require('./logger');

// UUID namespace for deterministic UUID generation
const UUID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/**
 * MigrationTransformer class for comprehensive data transformation and validation
 */
class MigrationTransformer {
  /**
   * Transform and sanitize text value
   * @param {string} value - Input text value
   * @param {Object} options - Transformation options
   * @returns {string} - Transformed text
   */
  static text(value, options = {}) {
    const {
      trim = true,
      maxLength = 500,
      defaultValue = '',
      lowercase = false,
      uppercase = false,
      removeHtml = true,
      allowEmpty = true
    } = options;

    if (value === null || value === undefined) {
      return defaultValue;
    }

    // Convert to string
    let text = String(value);

    // Trim whitespace
    if (trim) {
      text = text.trim();
    }

    // Check if empty after trimming
    if (!allowEmpty && text === '') {
      return defaultValue;
    }

    // Remove HTML tags
    if (removeHtml) {
      text = text.replace(/<[^>]*>/g, '');
    }

    // Apply case transformations
    if (lowercase) {
      text = text.toLowerCase();
    } else if (uppercase) {
      text = text.toUpperCase();
    }

    // Truncate to max length
    if (maxLength && text.length > maxLength) {
      text = text.substring(0, maxLength);
    }

    return text;
  }

  /**
   * Transform and validate numeric value
   * @param {any} value - Input value
   * @param {Object} options - Transformation options
   * @returns {number} - Transformed number
   */
  static number(value, options = {}) {
    const {
      defaultValue = 0,
      min = null,
      max = null,
      precision = null,
      allowNull = false,
      parseString = true
    } = options;

    // Handle null/undefined
    if (value === null || value === undefined) {
      return allowNull ? null : defaultValue;
    }

    let num;

    // Parse from string if needed
    if (typeof value === 'string' && parseString) {
      // Remove non-numeric characters except decimal point
      const cleanValue = value.replace(/[^0-9.-]/g, '');
      num = parseFloat(cleanValue);
    } else {
      num = parseFloat(value);
    }

    // Check if valid number
    if (isNaN(num)) {
      return allowNull ? null : defaultValue;
    }

    // Apply min/max constraints
    if (min !== null && num < min) {
      num = min;
    }
    if (max !== null && num > max) {
      num = max;
    }

    // Apply precision
    if (precision !== null) {
      const factor = Math.pow(10, precision);
      num = Math.round(num * factor) / factor;
    }

    return num;
  }

  /**
   * Transform and validate boolean value
   * @param {any} value - Input value
   * @param {Object} options - Transformation options
   * @returns {boolean} - Transformed boolean
   */
  static boolean(value, options = {}) {
    const {
      defaultValue = false,
      allowNull = false,
      treatAsTrue = [1, '1', 'true', 'yes', 'y', true],
      treatAsFalse = [0, '0', 'false', 'no', 'n', false]
    } = options;

    // Handle null/undefined
    if (value === null || value === undefined) {
      return allowNull ? null : defaultValue;
    }

    // Check against true/false values
    if (treatAsTrue.includes(value)) {
      return true;
    }
    if (treatAsFalse.includes(value)) {
      return false;
    }

    // Default fallback
    return defaultValue;
  }

  /**
   * Transform and validate date value
   * @param {any} value - Input date value
   * @param {Object} options - Transformation options
   * @returns {Date} - Transformed date
   */
  static date(value, options = {}) {
    const {
      defaultValue = null,
      format = null,
      minDate = null,
      maxDate = null,
      returnTimestamp = true,
      allowNull = true
    } = options;

    // Handle null/undefined
    if (value === null || value === undefined) {
      return allowNull ? null : defaultValue;
    }

    let date;

    // Parse date based on format
    if (format && typeof value === 'string') {
      const momentDate = moment(value, format);
      date = momentDate.isValid() ? momentDate.toDate() : null;
    } else {
      date = new Date(value);
    }

    // Check if valid date
    if (isNaN(date) || date === null) {
      return allowNull ? null : defaultValue;
    }

    // Apply min/max constraints
    if (minDate && date < new Date(minDate)) {
      date = new Date(minDate);
    }
    if (maxDate && date > new Date(maxDate)) {
      date = new Date(maxDate);
    }

    // Return as Firebase timestamp if needed
    return returnTimestamp ? date : date;
  }

  /**
   * Transform and validate array value
   * @param {any} value - Input array value
   * @param {Object} options - Transformation options
   * @returns {Array} - Transformed array
   */
  static array(value, options = {}) {
    const {
      defaultValue = [],
      maxItems = null,
      unique = true,
      itemTransform = null,
      allowEmpty = true,
      delimiter = null
    } = options;

    // Handle null/undefined
    if (value === null || value === undefined) {
      return allowEmpty ? defaultValue : [];
    }

    let array;

    // Convert to array if needed
    if (Array.isArray(value)) {
      array = [...value];
    } else if (typeof value === 'string' && delimiter) {
      array = value.split(delimiter).map(item => item.trim());
    } else {
      array = [value];
    }

    // Filter out empty/null values
    array = array.filter(item => item !== null && item !== undefined);

    if (!allowEmpty && array.length === 0) {
      return defaultValue;
    }

    // Apply item transformation
    if (itemTransform && typeof itemTransform === 'function') {
      array = array.map(item => itemTransform(item));
    }

    // Make unique
    if (unique) {
      array = [...new Set(array)];
    }

    // Limit to max items
    if (maxItems !== null && array.length > maxItems) {
      array = array.slice(0, maxItems);
    }

    return array;
  }

  /**
   * Transform and validate object value
   * @param {any} value - Input object value
   * @param {Object} options - Transformation options
   * @returns {Object} - Transformed object
   */
  static object(value, options = {}) {
    const {
      defaultValue = {},
      schema = null,
      allowExtra = true,
      allowNull = true
    } = options;

    // Handle null/undefined
    if (value === null || value === undefined) {
      return allowNull ? null : defaultValue;
    }

    // Ensure it's an object
    if (typeof value !== 'object' || Array.isArray(value)) {
      return defaultValue;
    }

    // Clone to avoid mutation
    let obj = { ...value };

    // Apply schema if provided
    if (schema) {
      const result = {};
      
      // Apply transforms based on schema
      for (const [key, config] of Object.entries(schema)) {
        const { type, options = {}, required = false } = config;
        
        if (obj[key] !== undefined) {
          // Transform the value according to its type
          if (type === 'text') {
            result[key] = MigrationTransformer.text(obj[key], options);
          } else if (type === 'number') {
            result[key] = MigrationTransformer.number(obj[key], options);
          } else if (type === 'boolean') {
            result[key] = MigrationTransformer.boolean(obj[key], options);
          } else if (type === 'date') {
            result[key] = MigrationTransformer.date(obj[key], options);
          } else if (type === 'array') {
            result[key] = MigrationTransformer.array(obj[key], options);
          } else if (type === 'object') {
            result[key] = MigrationTransformer.object(obj[key], options);
          } else {
            result[key] = obj[key];
          }
        } else if (required) {
          // Set default value for required fields
          result[key] = options.defaultValue || null;
        }
      }

      // Include extra fields if allowed
      if (allowExtra) {
        for (const [key, value] of Object.entries(obj)) {
          if (!schema[key]) {
            result[key] = value;
          }
        }
      }

      obj = result;
    }

    return obj;
  }

  /**
   * Generate a deterministic UUID from an input value
   * @param {any} value - Input value to generate UUID from
   * @param {string} type - Entity type for namespacing
   * @returns {string} - Generated UUID
   */
  static uuid(value, type = null) {
    if (!value) {
      return uuidv4();
    }

    const seed = `${type || 'default'}-${value}`;
    return uuidv5(seed, UUID_NAMESPACE);
  }

  /**
   * Generate a random UUID
   * @returns {string} - Generated UUID
   */
  static randomUuid() {
    return uuidv4();
  }

  /**
   * Standardize and validate a slug
   * @param {string} value - Input slug value
   * @param {Object} options - Transformation options
   * @returns {string} - Standardized slug
   */
  static slug(value, options = {}) {
    const {
      defaultValue = '',
      maxLength = 100,
      allowEmpty = false,
      sourceField = null
    } = options;

    // If value is missing but source field is provided
    if ((!value || value === '') && sourceField) {
      value = sourceField;
    }

    // Handle null/undefined
    if (value === null || value === undefined) {
      return allowEmpty ? '' : defaultValue;
    }

    let slug = String(value)
      .toLowerCase()
      .trim()
      .replace(/[\s_]+/g, '-')    // Replace spaces and underscores with hyphens
      .replace(/[^\w\-]+/g, '')   // Remove non-word characters except hyphens
      .replace(/\-\-+/g, '-')     // Replace multiple hyphens with a single hyphen
      .replace(/^-+/, '')         // Remove leading hyphens
      .replace(/-+$/, '');        // Remove trailing hyphens

    // Check if empty after processing
    if (slug === '' && !allowEmpty) {
      slug = defaultValue;
    }

    // Truncate to max length
    if (maxLength && slug.length > maxLength) {
      slug = slug.substring(0, maxLength);
    }

    return slug;
  }

  /**
   * Format a currency amount
   * @param {number|string} value - Input amount value
   * @param {Object} options - Formatting options
   * @returns {Object} - Formatted currency object
   */
  static currency(value, options = {}) {
    const {
      defaultValue = 0,
      currency = 'INR',
      precision = 2,
      min = 0,
      formatString = true
    } = options;

    // Parse the numeric value
    const amount = MigrationTransformer.number(value, {
      defaultValue,
      precision,
      min
    });

    // Return currency object
    const result = {
      amount,
      currency
    };

    // Add formatted string if requested
    if (formatString) {
      let formatter;
      try {
        formatter = new Intl.NumberFormat('en-IN', {
          style: 'currency',
          currency,
          minimumFractionDigits: precision
        });
        result.formatted = formatter.format(amount);
      } catch (error) {
        // Fallback formatting
        result.formatted = `${currency} ${amount.toFixed(precision)}`;
      }
    }

    return result;
  }

  /**
   * Transform a phone number to standard format
   * @param {string} value - Input phone number
   * @param {Object} options - Transformation options
   * @returns {string} - Standardized phone number
   */
  static phone(value, options = {}) {
    const {
      defaultValue = '',
      countryCode = '+91', // Default to India
      allowEmpty = true,
      validateFormat = true
    } = options;

    // Handle null/undefined
    if (value === null || value === undefined) {
      return allowEmpty ? '' : defaultValue;
    }

    // Normalize to string and remove non-digit characters
    let phone = String(value).replace(/[^\d+]/g, '');

    // Check if empty after processing
    if (phone === '') {
      return allowEmpty ? '' : defaultValue;
    }

    // Add country code if missing
    if (!phone.startsWith('+')) {
      phone = phone.startsWith('0') ? countryCode + phone.substring(1) : countryCode + phone;
    }

    // Validate format (simple check for demonstration)
    if (validateFormat) {
      const isValid = /^\+\d{1,3}\d{10,14}$/.test(phone);
      if (!isValid) {
        return defaultValue;
      }
    }

    return phone;
  }

  /**
   * Transform email address to standard format
   * @param {string} value - Input email
   * @param {Object} options - Transformation options
   * @returns {string} - Standardized email
   */
  static email(value, options = {}) {
    const {
      defaultValue = '',
      allowEmpty = true,
      validateFormat = true,
      lowercase = true
    } = options;

    // Handle null/undefined
    if (value === null || value === undefined) {
      return allowEmpty ? '' : defaultValue;
    }

    // Normalize to string and trim
    let email = String(value).trim();
    
    if (lowercase) {
      email = email.toLowerCase();
    }

    // Check if empty after processing
    if (email === '') {
      return allowEmpty ? '' : defaultValue;
    }

    // Validate format
    if (validateFormat) {
      const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!isValid) {
        return defaultValue;
      }
    }

    return email;
  }

  /**
   * Helper to create a standard location object
   * @param {Object} data - Input location data
   * @param {Object} options - Transformation options
   * @returns {Object} - Standardized location object
   */
  static location(data, options = {}) {
    const {
      defaultCountry = 'India',
      includeCoordinates = true
    } = options;

    // Default empty location
    const defaultLocation = {
      country: defaultCountry,
      state: '',
      city: '',
      address: '',
      landmark: '',
      pincode: '',
      coordinates: includeCoordinates ? { latitude: 0, longitude: 0 } : null,
      displayLocation: ''
    };

    // Return default if no data
    if (!data) {
      return defaultLocation;
    }

    // Build location object
    const location = {
      country: data.country || defaultCountry,
      state: data.state || '',
      city: data.city || '',
      address: data.address || '',
      landmark: data.landmark || '',
      pincode: data.pincode || '',
      coordinates: includeCoordinates ? {
        latitude: MigrationTransformer.number(data.latitude, { defaultValue: 0 }),
        longitude: MigrationTransformer.number(data.longitude, { defaultValue: 0 })
      } : null
    };

    // Build display location
    const displayParts = [];
    if (location.city) displayParts.push(location.city);
    if (location.state) displayParts.push(location.state);
    if (displayParts.length === 0 && location.country) displayParts.push(location.country);
    
    location.displayLocation = displayParts.join(', ');

    return location;
  }

  /**
   * Create entity references from ID mappings
   * @param {Object} entityMap - Map of entity IDs to their data
   * @param {Array} ids - IDs to reference
   * @param {Object} options - Reference options
   * @returns {Array} - Referenced entity IDs
   */
  static createEntityReferences(entityMap, ids, options = {}) {
    const {
      returnEmpty = true,
      idField = 'id',
      dataTransform = null
    } = options;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return returnEmpty ? [] : null;
    }

    // Map IDs to references
    const references = ids
      .map(id => {
        if (!id) return null;
        
        const entity = entityMap[id];
        if (!entity) return null;
        
        return dataTransform ? dataTransform(entity) : entity[idField];
      })
      .filter(ref => ref !== null);

    if (references.length === 0 && !returnEmpty) {
      return null;
    }

    return references;
  }

  /**
   * Validate data against a schema
   * @param {Object} data - Data to validate
   * @param {Object} schema - Validation schema
   * @returns {Object} - Validation result
   */
  static validate(data, schema) {
    const errors = [];
    const validData = {};

    // Check required fields
    for (const [key, config] of Object.entries(schema)) {
      const { required = false, type, options = {} } = config;
      
      if (required && (data[key] === undefined || data[key] === null)) {
        errors.push(`Required field '${key}' is missing`);
      }
      
      // Apply transformation based on type
      if (data[key] !== undefined) {
        try {
          if (type === 'text') {
            validData[key] = MigrationTransformer.text(data[key], options);
          } else if (type === 'number') {
            validData[key] = MigrationTransformer.number(data[key], options);
          } else if (type === 'boolean') {
            validData[key] = MigrationTransformer.boolean(data[key], options);
          } else if (type === 'date') {
            validData[key] = MigrationTransformer.date(data[key], options);
          } else if (type === 'array') {
            validData[key] = MigrationTransformer.array(data[key], options);
          } else if (type === 'object') {
            validData[key] = MigrationTransformer.object(data[key], options);
          } else if (type === 'email') {
            validData[key] = MigrationTransformer.email(data[key], options);
          } else if (type === 'phone') {
            validData[key] = MigrationTransformer.phone(data[key], options);
          } else if (type === 'slug') {
            validData[key] = MigrationTransformer.slug(data[key], options);
          } else {
            validData[key] = data[key];
          }
        } catch (error) {
          errors.push(`Error transforming field '${key}': ${error.message}`);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      data: validData
    };
  }

  /**
   * Log transformation error with details
   * @param {Error} error - Error object
   * @param {Object} context - Error context
   */
  static logError(error, context = {}) {
    const { entity, id, field, value } = context;
    
    logger.error(`Transformation error: ${error.message}`);
    
    if (entity) {
      logger.error(`Entity: ${entity}`);
    }
    
    if (id) {
      logger.error(`ID: ${id}`);
    }
    
    if (field) {
      logger.error(`Field: ${field}`);
    }
    
    if (value !== undefined) {
      logger.error(`Value: ${JSON.stringify(value)}`);
    }
    
    if (error.stack) {
      logger.debug(error.stack);
    }
  }
}

module.exports = MigrationTransformer;
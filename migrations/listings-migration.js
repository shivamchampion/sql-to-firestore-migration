/**
 * Migration module for listings collection
 * Handles businesses, franchises, investors, etc.
 */
const { getOrCreateUUID, getUUID } = require('../utils/uuid-mapper');
const { processBatch } = require('../utils/batch-processor');
const { 
  LISTING_TYPES, 
  LISTING_STATUS, 
  DEFAULTS 
} = require('../config/migration-config');
const logger = require('../utils/logger');

/**
 * Migrate listings from SQL to Firestore
 * @param {FirebaseFirestore.Firestore} db - Firestore instance
 * @param {Object} data - SQL data containing all listing-related tables
 * @param {Object} options - Migration options
 * @returns {Promise<Object>} - Migration result
 */
async function migrate(db, data, options = {}) {
  logger.info('Starting listings migration');
  
  // Extract listing tables from data
  const {
    businesses = [],
    business_media = [],
    franchise = [],
    franchise_media = [],
    franchise_formats = [],
    investors = [],
    investor_sub_industries = [],
    investor_location_preference = [],
    sub_industries = [],
    industries = [],
    cities = [],
    states = []
  } = data;
  
  // Step 1: Prepare industries data for reference
  await prepareIndustries(industries, sub_industries);
  
  // Step 2: Prepare location data for reference
  await prepareLocations(cities, states);
  
  // Step 3: Migrate businesses
  const businessResult = await processBatch(
    businesses,
    async (business) => transformBusiness(business, { business_media, sub_industries, cities }),
    {
      collection: 'listings',
      dryRun: options.dryRun,
      label: 'Migrating businesses',
      batchSize: 50
    }
  );
  
  // Step 4: Migrate franchises
  const franchiseResult = await processBatch(
    franchise,
    async (franchiseItem) => transformFranchise(franchiseItem, { 
      franchise_media, 
      franchise_formats, 
      sub_industries, 
      cities 
    }),
    {
      collection: 'listings',
      dryRun: options.dryRun,
      label: 'Migrating franchises',
      batchSize: 50
    }
  );
  
  // Step 5: Migrate investors
  const investorResult = await processBatch(
    investors,
    async (investor) => transformInvestor(investor, { 
      investor_sub_industries, 
      investor_location_preference, 
      sub_industries, 
      cities 
    }),
    {
      collection: 'listings',
      dryRun: options.dryRun,
      label: 'Migrating investors',
      batchSize: 50
    }
  );
  
  // Combine results
  const totalCount = businessResult.processedCount + franchiseResult.processedCount + investorResult.processedCount;
  const errors = [
    ...businessResult.errors,
    ...franchiseResult.errors,
    ...investorResult.errors
  ];
  
  logger.info(`Listings migration completed: ${totalCount} listings processed with ${errors.length} errors`);
  
  return {
    collection: 'listings',
    count: totalCount,
    errors
  };
}

/**
 * Prepare industries data by creating UUIDs for all industries and sub-industries
 * @param {Array<Object>} industries - Industries data
 * @param {Array<Object>} subIndustries - Sub-industries data
 */
async function prepareIndustries(industries, subIndustries) {
  // Create UUIDs for all industries
  for (const industry of industries) {
    getOrCreateUUID('industries', industry.id);
  }
  
  // Create UUIDs for all sub-industries
  for (const subIndustry of subIndustries) {
    getOrCreateUUID('sub_industries', subIndustry.id);
  }
}

/**
 * Prepare location data by creating UUIDs for all cities and states
 * @param {Array<Object>} cities - Cities data
 * @param {Array<Object>} states - States data
 */
async function prepareLocations(cities, states) {
  // Create UUIDs for all cities
  for (const city of cities) {
    getOrCreateUUID('cities', city.id);
  }
  
  // Create UUIDs for all states
  for (const state of states) {
    getOrCreateUUID('states', state.id);
  }
}

/**
 * Transform business data to match Firestore schema
 * @param {Object} business - Business data
 * @param {Object} relatedData - Related data (media, industries, etc.)
 * @returns {Object} - Firestore document operation
 */
function transformBusiness(business, relatedData) {
  const { business_media = [], sub_industries = [], cities = [] } = relatedData;
  
  // Generate a UUID for the business
  const businessId = getOrCreateUUID('businesses', business.id);
  // Add to listings map for later reference
  getOrCreateUUID('listings', business.id);
  
  // Find business media
  const media = business_media.filter(item => item.business_id === business.id);
  
  // Get city information
  const city = cities.find(city => city.id === business.city_id);
  
  // Get sub-industry information
  const subIndustry = sub_industries.find(si => si.id === business.sub_industry_id);
  
  // Convert status
  let status = LISTING_STATUS.ACTIVE;
  if (business.status) {
    switch (business.status.toLowerCase()) {
      case 'active':
        status = LISTING_STATUS.ACTIVE;
        break;
      case 'inactive':
        status = LISTING_STATUS.INACTIVE;
        break;
      case 'pending':
        status = LISTING_STATUS.PENDING;
        break;
      case 'deleted':
        status = LISTING_STATUS.DELETED;
        break;
      default:
        status = LISTING_STATUS.ACTIVE;
    }
  }
  
  // Transform business to match the Firestore schema
  const firestoreBusiness = {
    // Core fields (common to all listings)
    id: businessId,
    type: LISTING_TYPES.BUSINESS,
    name: business.company_name || '',
    slug: business.slug || '',
    description: business.introduction || '',
    shortDescription: business.headline || '',
    headline: business.headline || '',
    
    // Media
    media: {
      featuredImage: {
        url: business.cover_image || '',
        path: `listings/${businessId}/featured_image`,
        alt: business.company_name || '',
        width: 0,
        height: 0
      },
      galleryImages: media.filter(item => item.type === 'image').map(item => ({
        url: item.url || '',
        path: `listings/${businessId}/gallery/${item.id}`,
        alt: business.company_name || '',
        width: 0,
        height: 0
      })),
      videos: media.filter(item => item.type === 'video').map(item => ({
        url: item.url || '',
        title: business.company_name || '',
        thumbnail: ''
      })),
      documents: []
    },
    
    // Location
    location: {
      country: 'India',
      state: '',
      city: city ? city.name : '',
      address: business.address || '',
      landmark: '',
      pincode: business.pincode ? String(business.pincode) : '',
      coordinates: {
        latitude: 0,
        longitude: 0
      },
      displayLocation: city ? city.name : ''
    },
    
    // Contact information
    contactInfo: {
      email: business.contact_user_email || '',
      phone: business.contact_user_mobile || '',
      alternatePhone: '',
      website: business.website || '',
      contactName: business.contact_user_name || '',
      designation: business.contact_user_designation || '',
      preferredContactMethod: 'email',
      availableHours: '',
      socialMedia: {
        facebook: {
          url: '',
          handle: '',
          verified: false
        },
        twitter: {
          url: '',
          handle: '',
          verified: false
        },
        instagram: {
          url: '',
          handle: '',
          verified: false
        },
        linkedin: {
          url: '',
          handle: '',
          verified: false
        }
      }
    },
    
    // SEO
    seo: {
      title: business.company_name || '',
      description: business.introduction ? business.introduction.substring(0, 160) : '',
      keywords: [],
      ogImage: business.cover_image || ''
    },
    urlHash: business.hash || '',
    
    // Ratings and verification
    rating: {
      average: 0,
      count: 0,
      distribution: {
        "1": 0,
        "2": 0,
        "3": 0,
        "4": 0,
        "5": 0
      }
    },
    reviewCount: 0,
    verified: true,
    verificationDetails: {
      verifiedAt: business.date_posted || DEFAULTS.CREATED_AT,
      verifiedBy: 'system',
      documents: [],
      notes: ''
    },
    featured: business.is_premium === 1,
    featuredUntil: null,
    
    // Subscription and status
    plan: business.is_premium === 1 ? 'premium' : 'basic',
    status: status,
    statusReason: '',
    statusHistory: [{
      status: status,
      reason: '',
      timestamp: business.date_posted || DEFAULTS.CREATED_AT,
      updatedBy: 'system'
    }],
    
    // Ownership
    ownerId: getUUID('users', business.user_id) || null,
    ownerName: '',
    ownerType: 'user',
    ownership: {
      transferable: false,
      transferHistory: []
    },
    
    // Classification
    industries: subIndustry ? [subIndustry.industry_id] : [],
    subIndustries: subIndustry ? [subIndustry.id] : [],
    tags: [],
    attributes: {},
    
    // Analytics
    analytics: {
      viewCount: 0,
      uniqueViewCount: 0,
      contactCount: 0,
      favoriteCount: 0,
      lastViewed: null,
      averageTimeOnPage: 0,
      conversionRate: 0,
      searchAppearances: 0,
      referrers: {}
    },
    
    // Display settings
    displaySettings: {
      highlight: business.is_hot === 1,
      badge: business.is_premium === 1 ? 'premium' : '',
      pageOrder: business.page_order || 0,
      showContactInfo: true,
      showAnalytics: business.is_premium === 1
    },
    
    // Admin management
    adminNotes: '',
    qualityScore: 75,
    flaggedCount: 0,
    flags: [],
    
    // Additional settings
    settings: {
      allowComments: true,
      allowSharing: true,
      hideFromSearch: false
    },
    
    // Timestamps
    createdAt: business.date_posted || DEFAULTS.CREATED_AT,
    updatedAt: business.date_updated || DEFAULTS.UPDATED_AT,
    publishedAt: business.date_posted || DEFAULTS.CREATED_AT,
    expiresAt: null,
    lastPromotedAt: null,
    
    // BUSINESS TYPE FIELDS
    businessDetails: {
      businessType: business.business_type || '',
      entityType: business.entity_type || '',
      establishedYear: business.establish_year || null,
      registrationNumber: '',
      gstNumber: '',
      panNumber: '',
      licenses: [],
      certifications: [],
      awards: [],
      
      // Operations
      operations: {
        employees: {
          count: business.employee_count ? parseInt(business.employee_count, 10) : 0,
          fullTime: 0,
          partTime: 0,
          contractual: 0
        },
        businessHours: {
          monday: { open: '09:00', close: '18:00' },
          tuesday: { open: '09:00', close: '18:00' },
          wednesday: { open: '09:00', close: '18:00' },
          thursday: { open: '09:00', close: '18:00' },
          friday: { open: '09:00', close: '18:00' },
          saturday: { open: '09:00', close: '18:00' },
          sunday: { open: '00:00', close: '00:00' }
        },
        locations: [{
          type: 'main',
          address: business.address || '',
          city: city ? city.name : '',
          state: ''
        }],
        serviceAreas: [],
        operationalYears: business.establish_year ? (new Date().getFullYear() - business.establish_year) : 0,
        seasonality: ''
      },
      
      // Financials
      financials: {
        annualRevenue: {
          amount: business.annual_sales || 0,
          currency: 'INR',
          period: 'yearly',
          verified: false
        },
        monthlyRevenue: {
          amount: business.annual_sales ? Math.round(business.annual_sales / 12) : 0,
          currency: 'INR',
          trend: 'stable'
        },
        profitMargin: {
          percentage: business.ebitda_margin || 0,
          trend: 'stable'
        },
        ebitda: {
          amount: business.ebitda || 0,
          currency: 'INR',
          margin: business.ebitda_margin || 0
        },
        expenses: {
          rent: { amount: business.rentals || 0, currency: 'INR' },
          payroll: { amount: 0, currency: 'INR' },
          utilities: { amount: 0, currency: 'INR' },
          marketing: { amount: 0, currency: 'INR' },
          other: { amount: 0, currency: 'INR' },
          total: { amount: business.rentals || 0, currency: 'INR' }
        },
        financialHealth: 'stable',
        financialTrend: 'stable',
        financialDocuments: [],
        revenueStreams: []
      },
      
      // Assets
      assets: {
        inventory: {
          included: business.inventory_value > 0,
          value: { amount: business.inventory_value || 0, currency: 'INR' },
          description: '',
          lastValuationDate: null
        },
        equipment: {
          included: false,
          value: { amount: 0, currency: 'INR' },
          description: '',
          condition: '',
          agingYears: 0
        },
        intellectualProperty: {
          included: false,
          types: [],
          description: '',
          value: { amount: 0, currency: 'INR' }
        },
        realEstate: {
          included: business.rentals > 0,
          owned: false,
          leased: business.rentals > 0,
          details: '',
          lease: {
            expiryDate: null,
            monthlyRent: { amount: business.rentals || 0, currency: 'INR' },
            transferable: false,
            terms: ''
          },
          value: { amount: 0, currency: 'INR' }
        },
        digitalAssets: {
          included: !!business.website,
          website: !!business.website,
          socialMediaAccounts: false,
          customerDatabase: false,
          description: ''
        },
        keyAssets: []
      },
      
      // Sale information
      sale: {
        askingPrice: {
          amount: 0,
          currency: 'INR',
          formattedPrice: '',
          priceJustification: '',
          priceMultiple: 0
        },
        reasonForSelling: '',
        sellingUrgency: '',
        negotiable: true,
        sellerFinancing: {
          available: false,
          details: '',
          terms: ''
        },
        trainingAndSupport: {
          trainingPeriod: '',
          supportIncluded: false,
          supportDetails: ''
        },
        nonCompete: {
          included: false,
          terms: '',
          duration: '',
          geographicScope: ''
        },
        saleTerms: '',
        confidentiality: {
          nda: true,
          disclosureProcess: '',
          restrictedInfo: ''
        }
      },
      
      // Market & competition
      market: {
        targetMarket: '',
        marketSize: '',
        marketShare: '',
        marketTrend: 'stable',
        competitors: {
          major: [],
          competitive_advantage: [],
          barriers_to_entry: []
        },
        industryOutlook: '',
        seasonality: '',
        regulations: [],
        threats: [],
        opportunities: []
      },
      
      // Customers & sales
      customers: {
        customerBase: '',
        customerDemographics: {},
        keyAccounts: [],
        contractStatus: {
          contractsInPlace: false,
          transferable: false,
          averageDuration: ''
        },
        customerConcentration: {
          topCustomerPercentage: 0,
          top5CustomerPercentage: 0,
          diversificationLevel: ''
        },
        customerAcquisition: {
          channels: [],
          cost: { amount: 0, currency: 'INR' },
          strategy: ''
        },
        customerRetention: {
          rate: 0,
          strategy: '',
          loyaltyPrograms: false
        },
        salesCycle: {
          length: '',
          stages: [],
          conversionRate: 0
        }
      }
    },
    
    // Common fields
    isDeleted: false
  };
  
  return {
    docId: businessId,
    data: firestoreBusiness
  };
}

/**
 * Transform franchise data to match Firestore schema
 * @param {Object} franchiseItem - Franchise data
 * @param {Object} relatedData - Related data (media, formats, industries, etc.)
 * @returns {Object} - Firestore document operation
 */
function transformFranchise(franchiseItem, relatedData) {
  const { 
    franchise_media = [], 
    franchise_formats = [], 
    sub_industries = [], 
    cities = [] 
  } = relatedData;
  
  // Generate a UUID for the franchise
  const franchiseId = getOrCreateUUID('franchise', franchiseItem.id);
  // Add to listings map for later reference
  getOrCreateUUID('listings', franchiseItem.id);
  
  // Find franchise media
  const media = franchise_media.filter(item => item.franchise_id === franchiseItem.id);
  
  // Find franchise formats
  const formats = franchise_formats.filter(format => format.franchise_id === franchiseItem.id);
  
  // Get headquarter city information
  const city = cities.find(city => city.id === franchiseItem.headquarter_city_id);
  
  // Get sub-industry information
  const subIndustry = sub_industries.find(si => si.id === franchiseItem.sub_industry_id);
  
  // Convert status
  let status = LISTING_STATUS.ACTIVE;
  if (franchiseItem.status) {
    switch (franchiseItem.status.toLowerCase()) {
      case 'active':
        status = LISTING_STATUS.ACTIVE;
        break;
      case 'inactive':
        status = LISTING_STATUS.INACTIVE;
        break;
      case 'pending':
        status = LISTING_STATUS.PENDING;
        break;
      case 'deleted':
        status = LISTING_STATUS.DELETED;
        break;
      default:
        status = LISTING_STATUS.ACTIVE;
    }
  }
  
  // Calculate investment range from formats
  let minInvestment = 0;
  let maxInvestment = 0;
  if (formats.length > 0) {
    minInvestment = Math.min(...formats.map(f => f.invest_min));
    maxInvestment = Math.max(...formats.map(f => f.invest_max));
  }
  
  // Transform franchise to match the Firestore schema
  const firestoreFranchise = {
    // Core fields (common to all listings)
    id: franchiseId,
    type: LISTING_TYPES.FRANCHISE,
    name: franchiseItem.brand_name || '',
    slug: franchiseItem.slug || '',
    description: franchiseItem.summary || '',
    shortDescription: franchiseItem.offering || '',
    headline: franchiseItem.offering || '',
    
    // Media
    media: {
      featuredImage: {
        url: franchiseItem.brand_logo || '',
        path: `listings/${franchiseId}/featured_image`,
        alt: franchiseItem.brand_name || '',
        width: 0,
        height: 0
      },
      galleryImages: media.filter(item => item.type === 'image').map(item => ({
        url: item.url || '',
        path: `listings/${franchiseId}/gallery/${item.id}`,
        alt: franchiseItem.brand_name || '',
        width: 0,
        height: 0
      })),
      videos: media.filter(item => item.type === 'video').map(item => ({
        url: item.url || '',
        title: franchiseItem.brand_name || '',
        thumbnail: ''
      })),
      documents: []
    },
    
    // Location
    location: {
      country: 'India',
      state: '',
      city: city ? city.name : '',
      address: '',
      landmark: '',
      pincode: '',
      coordinates: {
        latitude: 0,
        longitude: 0
      },
      displayLocation: city ? city.name : ''
    },
    
    // Contact information
    contactInfo: {
      email: franchiseItem.official_email || '',
      phone: franchiseItem.mobile || '',
      alternatePhone: '',
      website: franchiseItem.website || '',
      contactName: franchiseItem.authorized_person || '',
      designation: franchiseItem.designation || '',
      preferredContactMethod: 'email',
      availableHours: '',
      socialMedia: {
        facebook: {
          url: '',
          handle: '',
          verified: false
        },
        twitter: {
          url: '',
          handle: '',
          verified: false
        },
        instagram: {
          url: '',
          handle: '',
          verified: false
        },
        linkedin: {
          url: '',
          handle: '',
          verified: false
        }
      }
    },
    
    // SEO
    seo: {
      title: franchiseItem.brand_name || '',
      description: franchiseItem.summary ? franchiseItem.summary.substring(0, 160) : '',
      keywords: [],
      ogImage: franchiseItem.brand_logo || ''
    },
    urlHash: franchiseItem.hash || '',
    
    // Ratings and verification
    rating: {
      average: 0,
      count: 0,
      distribution: {
        "1": 0,
        "2": 0,
        "3": 0,
        "4": 0,
        "5": 0
      }
    },
    reviewCount: 0,
    verified: true,
    verificationDetails: {
      verifiedAt: franchiseItem.date_created || DEFAULTS.CREATED_AT,
      verifiedBy: 'system',
      documents: [],
      notes: ''
    },
    featured: franchiseItem.is_premium === 1,
    featuredUntil: null,
    
    // Subscription and status
    plan: franchiseItem.is_premium === 1 ? 'premium' : 'basic',
    status: status,
    statusReason: '',
    statusHistory: [{
      status: status,
      reason: '',
      timestamp: franchiseItem.date_created || DEFAULTS.CREATED_AT,
      updatedBy: 'system'
    }],
    
    // Ownership
    ownerId: getUUID('users', franchiseItem.user_id) || null,
    ownerName: '',
    ownerType: 'user',
    ownership: {
      transferable: false,
      transferHistory: []
    },
    
    // Classification
    industries: subIndustry ? [subIndustry.industry_id] : [],
    subIndustries: subIndustry ? [subIndustry.id] : [],
    tags: [],
    attributes: {},
    
    // Analytics
    analytics: {
      viewCount: 0,
      uniqueViewCount: 0,
      contactCount: 0,
      favoriteCount: 0,
      lastViewed: null,
      averageTimeOnPage: 0,
      conversionRate: 0,
      searchAppearances: 0,
      referrers: {}
    },
    
    // Display settings
    displaySettings: {
      highlight: franchiseItem.is_hot === 1,
      badge: franchiseItem.is_premium === 1 ? 'premium' : '',
      pageOrder: franchiseItem.page_order || 0,
      showContactInfo: true,
      showAnalytics: franchiseItem.is_premium === 1
    },
    
    // Admin management
    adminNotes: '',
    qualityScore: 75,
    flaggedCount: 0,
    flags: [],
    
    // Additional settings
    settings: {
      allowComments: true,
      allowSharing: true,
      hideFromSearch: false
    },
    
    // Timestamps
    createdAt: franchiseItem.date_created || DEFAULTS.CREATED_AT,
    updatedAt: franchiseItem.date_updated || DEFAULTS.UPDATED_AT,
    publishedAt: franchiseItem.date_created || DEFAULTS.CREATED_AT,
    expiresAt: null,
    lastPromotedAt: null,
    
    // FRANCHISE TYPE FIELDS
    franchiseDetails: {
      franchiseType: franchiseItem.type || '',
      franchiseBrand: franchiseItem.brand_name || '',
      establishedYear: franchiseItem.establish_year || null,
      totalOutlets: franchiseItem.total_outlets || 0,
      totalFranchisees: franchiseItem.total_franchise || 0,
      companyOwnedUnits: 0,
      countryOfOrigin: 'India',
      industryStanding: '',
      franchiseStartYear: franchiseItem.establish_year || null,
      awards: [],
      
      // Investment details
      investment: {
        investmentRange: {
          min: { amount: minInvestment || 0, currency: 'INR' },
          max: { amount: maxInvestment || 0, currency: 'INR' },
          formattedRange: `₹${minInvestment.toLocaleString()} - ₹${maxInvestment.toLocaleString()}`
        },
        franchiseFee: {
          amount: formats.length > 0 ? formats[0].brand_fee : 0,
          currency: 'INR',
          refundable: false,
          paymentTerms: ''
        },
        royaltyFee: {
          percentage: 0,
          structure: '',
          frequency: ''
        },
        marketingFee: {
          percentage: 0,
          structure: '',
          utilization: ''
        },
        estimatedTotalInvestment: {
          amount: maxInvestment || 0,
          currency: 'INR',
          breakdown: {}
        },
        ongoingFees: [],
        additionalInvestmentNeeds: '',
        workingCapitalRequirement: {
          amount: 0,
          currency: 'INR',
          duration: ''
        }
      },
      
      // Terms and conditions
      terms: {
        contractDuration: {
          years: franchiseItem.term_duration_year || 0,
          renewalOption: franchiseItem.is_term_renewable === 1
        },
        renewalTerms: {
          available: franchiseItem.is_term_renewable === 1,
          fee: { amount: 0, currency: 'INR' },
          conditions: ''
        },
        terminationConditions: '',
        transferRights: {
          transferable: false,
          transferFee: { amount: 0, currency: 'INR' },
          conditions: ''
        },
        territoryRights: {
          exclusive: false,
          protectionRadius: '',
          restrictions: ''
        },
        spaceRequirement: {
          minArea: formats.length > 0 ? `${formats[0].space_min} sq ft` : '',
          maxArea: formats.length > 0 ? `${formats[0].space_max} sq ft` : '',
          location: ''
        },
        proprietaryInformation: {
          duration: '',
          restrictions: ''
        }
      },
      
      // Support offered
      support: {
        initialSupport: {
          trainingProvided: true,
          trainingDuration: '',
          trainingLocation: '',
          trainingContent: [],
          siteSelection: true,
          constructionSupport: false,
          grandOpeningSupport: true
        },
        ongoingSupport: {
          fieldSupport: {
            available: true,
            frequency: '',
            details: franchiseItem.assistance || ''
          },
          marketingSupport: {
            available: true,
            materials: [],
            campaigns: [],
            details: ''
          },
          operationalSupport: {
            available: true,
            manuals: true,
            helpdesk: true,
            details: ''
          },
          trainingUpdates: {
            available: true,
            frequency: '',
            format: ''
          }
        }
      },
      
      // Performance metrics
      performance: {
        salesData: {
          averageUnitSales: { 
            amount: formats.length > 0 ? formats[0].monthly_sales : 0, 
            currency: 'INR' 
          },
          salesGrowth: '',
          topUnitSales: { 
            amount: formats.length > 0 ? formats[0].monthly_sales * 1.5 : 0, 
            currency: 'INR' 
          },
          salesMaturityPeriod: ''
        },
        profitability: {
          averageProfitMargin: formats.length > 0 ? `${formats[0].profit_margin}%` : '',
          breakEvenPeriod: '',
          paybackPeriod: '',
          returnOnInvestment: ''
        }
      }
    },
    
    // Common fields
    isDeleted: false
  };
  
  return {
    docId: franchiseId,
    data: firestoreFranchise
  };
}

/**
 * Transform investor data to match Firestore schema
 * @param {Object} investor - Investor data
 * @param {Object} relatedData - Related data (sub-industries, locations, etc.)
 * @returns {Object} - Firestore document operation
 */
function transformInvestor(investor, relatedData) {
  const { 
    investor_sub_industries = [], 
    investor_location_preference = [], 
    sub_industries = [], 
    cities = [] 
  } = relatedData;
  
  // Generate a UUID for the investor
  const investorId = getOrCreateUUID('investors', investor.id);
  // Add to listings map for later reference
  getOrCreateUUID('listings', investor.id);
  
  // Find investor sub-industries
  const investorSubIndustries = investor_sub_industries.filter(
    item => item.investor_id === investor.id
  );
  
  // Find investor location preferences
  const investorLocations = investor_location_preference.filter(
    item => item.investor_id === investor.id
  );
  
  // Get city information
  const city = cities.find(city => city.id === investor.city_id);
  
  // Convert status
  let status = LISTING_STATUS.ACTIVE;
  if (investor.status) {
    switch (investor.status.toLowerCase()) {
      case 'active':
        status = LISTING_STATUS.ACTIVE;
        break;
      case 'inactive':
        status = LISTING_STATUS.INACTIVE;
        break;
      case 'pending':
        status = LISTING_STATUS.PENDING;
        break;
      case 'deleted':
        status = LISTING_STATUS.DELETED;
        break;
      default:
        status = LISTING_STATUS.ACTIVE;
    }
  }
  
  // Get all sub-industry IDs and then get corresponding industry IDs
  const subIndustryIds = investorSubIndustries.map(isi => isi.sub_industry_id);
  const subIndustryEntities = subIndustryIds.map(id => 
    sub_industries.find(si => si.id === id)
  ).filter(Boolean);
  
  const industryIds = [...new Set(subIndustryEntities.map(si => si.industry_id))];
  
  // Transform investor to match the Firestore schema
  const firestoreInvestor = {
    // Core fields (common to all listings)
    id: investorId,
    type: LISTING_TYPES.INVESTOR,
    name: investor.full_name || '',
    slug: investor.slug || '',
    description: investor.about || '',
    shortDescription: investor.headline || '',
    headline: investor.headline || '',
    
    // Media
    media: {
      featuredImage: {
        url: investor.cover_image || '',
        path: `listings/${investorId}/featured_image`,
        alt: investor.full_name || '',
        width: 0,
        height: 0
      },
      galleryImages: [],
      videos: [],
      documents: [{
        url: investor.business_proof || '',
        path: `listings/${investorId}/documents/business_proof`,
        name: 'Business Proof',
        type: 'pdf',
        size: 0,
        isPublic: false
      }]
    },
    
    // Location
    location: {
      country: 'India',
      state: '',
      city: city ? city.name : '',
      address: '',
      landmark: '',
      pincode: '',
      coordinates: {
        latitude: 0,
        longitude: 0
      },
      displayLocation: city ? city.name : ''
    },
    
    // Contact information
    contactInfo: {
      email: investor.email || '',
      phone: investor.mobile || '',
      alternatePhone: '',
      website: investor.company_website || '',
      contactName: investor.full_name || '',
      designation: investor.designation || '',
      preferredContactMethod: 'email',
      availableHours: '',
      socialMedia: {
        facebook: {
          url: '',
          handle: '',
          verified: false
        },
        twitter: {
          url: '',
          handle: '',
          verified: false
        },
        instagram: {
          url: '',
          handle: '',
          verified: false
        },
        linkedin: {
          url: investor.linkedin_profile || '',
          handle: '',
          verified: false
        }
      }
    },
    
    // SEO
    seo: {
      title: investor.full_name || '',
      description: investor.about ? investor.about.substring(0, 160) : '',
      keywords: [],
      ogImage: investor.cover_image || ''
    },
    urlHash: investor.hash || '',
    
    // Ratings and verification
    rating: {
      average: 0,
      count: 0,
      distribution: {
        "1": 0,
        "2": 0,
        "3": 0,
        "4": 0,
        "5": 0
      }
    },
    reviewCount: 0,
    verified: true,
    verificationDetails: {
      verifiedAt: investor.date_created || DEFAULTS.CREATED_AT,
      verifiedBy: 'system',
      documents: [],
      notes: ''
    },
    featured: investor.is_premium === 1,
    featuredUntil: null,
    
    // Subscription and status
    plan: investor.is_premium === 1 ? 'premium' : 'basic',
    status: status,
    statusReason: '',
    statusHistory: [{
      status: status,
      reason: '',
      timestamp: investor.date_created || DEFAULTS.CREATED_AT,
      updatedBy: 'system'
    }],
    
    // Ownership
    ownerId: getUUID('users', investor.user_id) || null,
    ownerName: investor.full_name || '',
    ownerType: 'user',
    ownership: {
      transferable: false,
      transferHistory: []
    },
    
    // Classification
    industries: industryIds,
    subIndustries: subIndustryIds,
    tags: [],
    attributes: {},
    
    // Analytics
    analytics: {
      viewCount: 0,
      uniqueViewCount: 0,
      contactCount: 0,
      favoriteCount: 0,
      lastViewed: null,
      averageTimeOnPage: 0,
      conversionRate: 0,
      searchAppearances: 0,
      referrers: {}
    },
    
    // Display settings
    displaySettings: {
      highlight: investor.is_hot === 1,
      badge: investor.is_premium === 1 ? 'premium' : '',
      pageOrder: investor.page_order || 0,
      showContactInfo: true,
      showAnalytics: investor.is_premium === 1
    },
    
    // Admin management
    adminNotes: '',
    qualityScore: 75,
    flaggedCount: 0,
    flags: [],
    
    // Additional settings
    settings: {
      allowComments: true,
      allowSharing: true,
      hideFromSearch: false
    },
    
    // Timestamps
    createdAt: investor.date_created || DEFAULTS.CREATED_AT,
    updatedAt: investor.date_updated || DEFAULTS.UPDATED_AT,
    publishedAt: investor.date_created || DEFAULTS.CREATED_AT,
    expiresAt: null,
    lastPromotedAt: null,
    
    // INVESTOR TYPE FIELDS
    investorDetails: {
      investorType: investor.investor_preference || '',
      establishedYear: null,
      investmentPhilosophy: investor.factors || '',
      experience: {
        years: 0,
        backgroundSummary: investor.about || ''
      },
      
      // Investment details
      investment: {
        capacity: {
          minInvestment: { amount: investor.investment_min || 0, currency: 'INR' },
          maxInvestment: { amount: investor.investment_max || 0, currency: 'INR' },
          totalFundsAvailable: { amount: investor.investment_max || 0, currency: 'INR' }
        },
        preferences: {
          averageInvestment: { 
            amount: investor.investment_min && investor.investment_max 
              ? Math.floor((investor.investment_min + investor.investment_max) / 2) 
              : 0, 
            currency: 'INR' 
          },
          typicalRounds: [],
          leadInvestor: true,
          coinvestors: [],
          stakeSought: {
            min: 0,
            max: investor.investment_stake || 0,
            controlling: investor.investment_stake > 50
          }
        },
        timing: {
          investmentTimeline: '',
          holdingPeriod: '',
          exitStrategy: []
        }
      },
      
      // Focus areas
      focus: {
        industries: {
          primary: industryIds,
          secondary: [],
          excluded: []
        },
        businessStage: {
          preferred: [],
          excluded: []
        },
        investmentStage: [],
        businessCriteria: {
          size: investor.puchasing_min && investor.puchasing_max
            ? [`${investor.puchasing_min} - ${investor.puchasing_max} Cr`]
            : [],
          profitability: '',
          growthRate: '',
          otherCriteria: []
        },
        geographicFocus: investorLocations.map(loc => {
          const locationCity = cities.find(c => c.id === loc.city_id);
          return locationCity ? locationCity.name : '';
        }).filter(Boolean)
      },
      
      // Portfolio
      portfolio: {
        overview: {
          totalInvestments: 0,
          activeInvestments: 0,
          exits: 0,
          successRate: ''
        },
        highlights: [],
        pastInvestments: [],
        currentInvestments: [],
        successStories: [],
        sectorDistribution: {}
      }
    },
    
    // Common fields
    isDeleted: false
  };
  
  return {
    docId: investorId,
    data: firestoreInvestor
  };
}

module.exports = {
  migrate
};
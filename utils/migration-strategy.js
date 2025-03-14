/**
 * Comprehensive migration strategy for SQL to Firestore
 * Provides high-level functions for entity mapping, transformation, and validation
 */
const MigrationTransformer = require('./migration-transformer');
const ValidationConfig = require('./migration-validation-config');
const { getOrCreateUUID, getUUID, mapIdsToUUIDs } = require('./uuid-mapper');
const logger = require('./logger');

/**
 * MigrationStrategy class provides high-level functions for the entire migration process
 */
class MigrationStrategy {
  /**
   * Entity Mapping functions (namespace)
   */
  static map = {
    /**
     * Create a comprehensive mapping for entities with proper UUID generation
     * @param {Array<Object>} entities - Entity array from SQL
     * @param {string} entityType - Type of entity for mapping
     * @param {Object} options - Mapping options
     * @returns {Object} - Mapped entities with UUIDs
     */
    entities: (entities, entityType, options = {}) => {
      const {
        idField = 'id',
        trackDependencies = true,
        nameField = 'name',
        parentField = null,
        parentType = null,
        transformFn = null
      } = options;

      const mappedEntities = {};
      const dependencies = {};
      const errors = [];

      if (!entities || !Array.isArray(entities)) {
        logger.warn(`No entities provided for mapping type: ${entityType}`);
        return { entities: mappedEntities, dependencies, errors };
      }

      // Process each entity
      entities.forEach(entity => {
        try {
          if (!entity || !entity[idField]) {
            throw new Error(`Entity missing ID field: ${idField}`);
          }

          // Generate UUID for the entity
          const uuid = getOrCreateUUID(entityType, entity[idField]);
          
          // Apply transformation if provided
          const transformedEntity = transformFn ? transformFn(entity) : {
            id: uuid,
            name: entity[nameField] || '',
            sourceId: entity[idField],
            status: entity.status === 1 || entity.status === true || entity.status === 'active'
          };

          // Track parent dependency if needed
          if (parentField && parentType && entity[parentField]) {
            const parentId = entity[parentField];
            if (trackDependencies) {
              if (!dependencies[parentType]) {
                dependencies[parentType] = {};
              }
              if (!dependencies[parentType][parentId]) {
                dependencies[parentType][parentId] = [];
              }
              dependencies[parentType][parentId].push({
                id: uuid,
                sourceId: entity[idField],
                entityType
              });
            }
            
            // Add parent reference to entity
            const parentUuid = getUUID(parentType, parentId);
            if (parentUuid) {
              transformedEntity.parentId = parentUuid;
            }
          }

          // Store the mapped entity
          mappedEntities[entity[idField]] = transformedEntity;
        } catch (error) {
          logger.error(`Error mapping ${entityType} entity ID ${entity?.[idField]}: ${error.message}`);
          errors.push({
            entityId: entity?.[idField],
            error: error.message
          });
        }
      });

      return { entities: mappedEntities, dependencies, errors };
    },

    /**
     * Create relationship mappings between entities
     * @param {Array<Object>} relationships - Relationship records from SQL
     * @param {Object} options - Relationship mapping options
     * @returns {Object} - Mapped relationships
     */
    relationships: (relationships, options = {}) => {
      const {
        sourceType,
        targetType,
        sourceField = 'source_id',
        targetField = 'target_id',
        relationshipType = 'many-to-many'
      } = options;

      const mappedRelationships = {
        bySource: {},
        byTarget: {}
      };

      if (!relationships || !Array.isArray(relationships)) {
        logger.warn(`No relationships provided for mapping: ${sourceType} -> ${targetType}`);
        return mappedRelationships;
      }

      // Process each relationship
      relationships.forEach(rel => {
        try {
          const sourceId = rel[sourceField];
          const targetId = rel[targetField];
          
          if (!sourceId || !targetId) {
            throw new Error(`Relationship missing source or target ID`);
          }

          // Get UUIDs for both entities
          const sourceUuid = getUUID(sourceType, sourceId);
          const targetUuid = getUUID(targetType, targetId);
          
          if (!sourceUuid || !targetUuid) {
            throw new Error(`Could not find UUIDs for relationship ${sourceType}:${sourceId} -> ${targetType}:${targetId}`);
          }

          // Store by source
          if (!mappedRelationships.bySource[sourceId]) {
            mappedRelationships.bySource[sourceId] = [];
          }
          mappedRelationships.bySource[sourceId].push(targetUuid);

          // Store by target
          if (!mappedRelationships.byTarget[targetId]) {
            mappedRelationships.byTarget[targetId] = [];
          }
          mappedRelationships.byTarget[targetId].push(sourceUuid);

        } catch (error) {
          logger.error(`Error mapping relationship: ${error.message}`);
        }
      });

      return mappedRelationships;
    }
  };

  /**
   * Transformation functions (namespace)
   */
  static transform = {
    /**
     * Transform a listing entity with comprehensive context
     * @param {Object} listing - Listing data from SQL
     * @param {string} type - Listing type (business, franchise, investor, etc.)
     * @param {Object} context - Related context (industries, cities, etc.)
     * @returns {Object} - Transformed listing for Firestore
     */
    listing: (listing, type, context = {}) => {
      if (!listing) {
        throw new Error('No listing data provided for transformation');
      }

      if (!type || !ValidationConfig.VALIDATION_RULES.LISTINGS.TYPES.includes(type)) {
        throw new Error(`Invalid listing type: ${type}`);
      }

      // Generate UUID for the listing
      const listingId = getOrCreateUUID('listings', listing.id);

      // Check required fields
      const requiredFields = ValidationConfig.VALIDATION_RULES.LISTINGS.REQUIRED_FIELDS[type] || [];
      const missingFields = requiredFields.filter(field => {
        const value = field.includes('.') 
          ? field.split('.').reduce((obj, key) => obj?.[key], listing)
          : listing[field];
        return value === undefined || value === null || value === '';
      });

      if (missingFields.length > 0) {
        logger.warn(`Listing ${listing.id} (${type}) is missing required fields: ${missingFields.join(', ')}`);
      }

      // Create the base listing document
      const baseListing = {
        id: listingId,
        type: type,
        name: MigrationTransformer.text(type === 'business' ? listing.company_name : (listing.brand_name || listing.full_name || '')),
        slug: MigrationTransformer.slug(listing.slug || '', { 
          sourceField: type === 'business' ? listing.company_name : (listing.brand_name || listing.full_name || '') 
        }),
        description: MigrationTransformer.text(listing.introduction || listing.summary || listing.about || '', {
          maxLength: ValidationConfig.VALIDATION_RULES.COMMON.TEXT_LENGTHS.DESCRIPTION
        }),
        shortDescription: MigrationTransformer.text(listing.headline || '', {
          maxLength: ValidationConfig.VALIDATION_RULES.COMMON.TEXT_LENGTHS.MEDIUM
        }),
        headline: MigrationTransformer.text(listing.headline || '', {
          maxLength: ValidationConfig.VALIDATION_RULES.COMMON.TEXT_LENGTHS.MEDIUM
        }),
        
        // Media (will be populated by type-specific transformers)
        media: {
          featuredImage: {},
          galleryImages: [],
          videos: [],
          documents: []
        },
        
        // Extract owner reference
        ownerId: getUUID('users', listing.user_id) || null,
        ownerType: 'user',
        
        // Status mapping
        status: MigrationStrategy.mapStatus(listing.status),
        
        // Default timestamps (will be updated by type-specific transformers)
        createdAt: MigrationTransformer.date(
          type === 'business' ? listing.date_posted : listing.date_created
        ) || new Date(),
        updatedAt: MigrationTransformer.date(
          type === 'business' ? listing.date_updated : listing.date_updated
        ) || new Date()
      };

      // Apply type-specific transformations
      let transformedListing;
      if (type === 'business') {
        transformedListing = MigrationStrategy.transform.businessListing(listing, baseListing, context);
      } else if (type === 'franchise') {
        transformedListing = MigrationStrategy.transform.franchiseListing(listing, baseListing, context);
      } else if (type === 'investor') {
        transformedListing = MigrationStrategy.transform.investorListing(listing, baseListing, context);
      } else {
        // Default transformation
        transformedListing = baseListing;
      }

      return transformedListing;
    },

    /**
     * Transform a business listing
     * @param {Object} business - Business data from SQL
     * @param {Object} baseListing - Base listing object
     * @param {Object} context - Related context (industries, cities, etc.)
     * @returns {Object} - Transformed business listing
     */
    businessListing: (business, baseListing, context = {}) => {
      const { industryMap = {}, subIndustryMap = {}, cityMap = {} } = context;
      
      // Get references to related entities
      const subIndustryId = business.sub_industry_id || null;
      const cityId = business.city_id || null;
      
      // Get sub-industry data
      let subIndustry = null;
      let industryId = null;
      
      if (subIndustryId && subIndustryMap[subIndustryId]) {
        subIndustry = subIndustryMap[subIndustryId];
        if (subIndustry.parentId) {
          industryId = subIndustry.parentId;
        }
      }
      
      // Get city data
      const city = cityId && cityMap[cityId] ? cityMap[cityId] : null;
      
      // Process featured image
      const featuredImage = business.cover_image ? {
        url: business.cover_image,
        path: `listings/${baseListing.id}/featured_image`,
        alt: baseListing.name,
        width: 0,
        height: 0
      } : null;
      
      // Process business media if available in context
      const media = context.business_media || [];
      const businessMedia = media.filter(item => item.business_id === business.id);
      
      // Default status
      const status = baseListing.status || 'active';
      
      // Location object
      const location = MigrationTransformer.location({
        country: 'India',
        state: '',
        city: city ? city.name : '',
        address: business.address || '',
        pincode: business.pincode || '',
      });
      
      // Extend the base listing with business-specific fields
      const extendedListing = {
        ...baseListing,
        
        // Update media
        media: {
          ...baseListing.media,
          featuredImage: featuredImage || {},
          galleryImages: businessMedia
            .filter(item => item.type === 'image')
            .map(item => ({
              url: item.url || '',
              path: `listings/${baseListing.id}/gallery/${item.id || MigrationTransformer.randomUuid()}`,
              alt: baseListing.name,
              width: 0,
              height: 0
            })),
          videos: businessMedia
            .filter(item => item.type === 'video')
            .map(item => ({
              url: item.url || '',
              title: baseListing.name,
              thumbnail: ''
            }))
        },
        
        // Location
        location: location,
        
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
            facebook: { url: '', handle: '', verified: false },
            twitter: { url: '', handle: '', verified: false },
            instagram: { url: '', handle: '', verified: false },
            linkedin: { url: '', handle: '', verified: false }
          }
        },
        
        // Classification
        industries: industryId ? [industryId] : [],
        subIndustries: subIndustryId ? [subIndustry?.id] : [],
        tags: [],
        
        // Premium/featured status
        featured: business.is_premium === 1,
        
        // Display settings
        displaySettings: {
          highlight: business.is_hot === 1,
          badge: business.is_premium === 1 ? 'premium' : '',
          pageOrder: business.page_order || 0,
          showContactInfo: true,
          showAnalytics: business.is_premium === 1
        },
        
        // Business-specific details
        businessDetails: {
          businessType: business.business_type || '',
          entityType: business.entity_type || '',
          establishedYear: MigrationTransformer.number(business.establish_year),
          
          // Operations
          operations: {
            employees: {
              count: MigrationTransformer.number(business.employee_count, { defaultValue: 0 }),
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
            operationalYears: business.establish_year 
              ? (new Date().getFullYear() - MigrationTransformer.number(business.establish_year))
              : 0
          },
          
          // Financials
          financials: {
            annualRevenue: {
              amount: MigrationTransformer.number(business.annual_sales, { defaultValue: 0 }),
              currency: 'INR',
              period: 'yearly',
              verified: false
            },
            monthlyRevenue: {
              amount: business.annual_sales 
                ? Math.round(MigrationTransformer.number(business.annual_sales) / 12) 
                : 0,
              currency: 'INR',
              trend: 'stable'
            },
            profitMargin: {
              percentage: MigrationTransformer.number(business.ebitda_margin, { defaultValue: 0 }),
              trend: 'stable'
            },
            ebitda: {
              amount: MigrationTransformer.number(business.ebitda, { defaultValue: 0 }),
              currency: 'INR',
              margin: MigrationTransformer.number(business.ebitda_margin, { defaultValue: 0 })
            },
            expenses: {
              rent: { 
                amount: MigrationTransformer.number(business.rentals, { defaultValue: 0 }), 
                currency: 'INR' 
              },
              payroll: { amount: 0, currency: 'INR' },
              utilities: { amount: 0, currency: 'INR' },
              marketing: { amount: 0, currency: 'INR' },
              other: { amount: 0, currency: 'INR' }
            }
          },
          
          // Assets
          assets: {
            inventory: {
              included: business.inventory_value > 0,
              value: { 
                amount: MigrationTransformer.number(business.inventory_value, { defaultValue: 0 }), 
                currency: 'INR' 
              },
              description: ''
            },
            realEstate: {
              included: business.rentals > 0,
              owned: false,
              leased: business.rentals > 0,
              lease: {
                monthlyRent: { 
                  amount: MigrationTransformer.number(business.rentals, { defaultValue: 0 }), 
                  currency: 'INR' 
                }
              }
            },
            digitalAssets: {
              included: !!business.website,
              website: !!business.website
            }
          }
        }
      };
      
      return extendedListing;
    },

    /**
     * Transform a franchise listing
     * @param {Object} franchise - Franchise data from SQL
     * @param {Object} baseListing - Base listing object
     * @param {Object} context - Related context
     * @returns {Object} - Transformed franchise listing
     */
    franchiseListing: (franchise, baseListing, context = {}) => {
      const { industryMap = {}, subIndustryMap = {}, cityMap = {} } = context;
      
      // Get references to related entities
      const subIndustryId = franchise.sub_industry_id || null;
      const cityId = franchise.headquarter_city_id || null;
      
      // Get sub-industry data
      let subIndustry = null;
      let industryId = null;
      
      if (subIndustryId && subIndustryMap[subIndustryId]) {
        subIndustry = subIndustryMap[subIndustryId];
        if (subIndustry.parentId) {
          industryId = subIndustry.parentId;
        }
      }
      
      // Get city data
      const city = cityId && cityMap[cityId] ? cityMap[cityId] : null;
      
      // Process featured image
      const featuredImage = franchise.brand_logo ? {
        url: franchise.brand_logo,
        path: `listings/${baseListing.id}/featured_image`,
        alt: baseListing.name,
        width: 0,
        height: 0
      } : null;
      
      // Process franchise media if available in context
      const media = context.franchise_media || [];
      const franchiseMedia = media.filter(item => item.franchise_id === franchise.id);
      
      // Process franchise formats if available
      const formats = context.franchise_formats || [];
      const franchiseFormats = formats.filter(format => format.franchise_id === franchise.id);
      
      // Calculate investment range from formats
      let minInvestment = 0;
      let maxInvestment = 0;
      
      if (franchiseFormats.length > 0) {
        minInvestment = Math.min(...franchiseFormats.map(f => 
          MigrationTransformer.number(f.invest_min, { defaultValue: 0 })
        ));
        maxInvestment = Math.max(...franchiseFormats.map(f => 
          MigrationTransformer.number(f.invest_max, { defaultValue: 0 })
        ));
      }
      
      // Location object
      const location = MigrationTransformer.location({
        country: 'India',
        state: '',
        city: city ? city.name : '',
        address: '',
        pincode: '',
      });
      
      // Extend the base listing with franchise-specific fields
      const extendedListing = {
        ...baseListing,
        
        // Update media
        media: {
          ...baseListing.media,
          featuredImage: featuredImage || {},
          galleryImages: franchiseMedia
            .filter(item => item.type === 'image')
            .map(item => ({
              url: item.url || '',
              path: `listings/${baseListing.id}/gallery/${item.id || MigrationTransformer.randomUuid()}`,
              alt: baseListing.name,
              width: 0,
              height: 0
            })),
          videos: franchiseMedia
            .filter(item => item.type === 'video')
            .map(item => ({
              url: item.url || '',
              title: baseListing.name,
              thumbnail: ''
            }))
        },
        
        // Location
        location: location,
        
        // Contact information
        contactInfo: {
          email: franchise.official_email || '',
          phone: franchise.mobile || '',
          alternatePhone: '',
          website: franchise.website || '',
          contactName: franchise.authorized_person || '',
          designation: franchise.designation || '',
          preferredContactMethod: 'email',
          availableHours: '',
          socialMedia: {
            facebook: { url: '', handle: '', verified: false },
            twitter: { url: '', handle: '', verified: false },
            instagram: { url: '', handle: '', verified: false },
            linkedin: { url: '', handle: '', verified: false }
          }
        },
        
        // Classification
        industries: industryId ? [industryId] : [],
        subIndustries: subIndustryId ? [subIndustry?.id] : [],
        tags: [],
        
        // Premium/featured status
        featured: franchise.is_premium === 1,
        
        // Display settings
        displaySettings: {
          highlight: franchise.is_hot === 1,
          badge: franchise.is_premium === 1 ? 'premium' : '',
          pageOrder: franchise.page_order || 0,
          showContactInfo: true,
          showAnalytics: franchise.is_premium === 1
        },
        
        // Franchise-specific details
        franchiseDetails: {
          franchiseType: franchise.type || '',
          franchiseBrand: franchise.brand_name || '',
          establishedYear: MigrationTransformer.number(franchise.establish_year),
          totalOutlets: MigrationTransformer.number(franchise.total_outlets, { defaultValue: 0 }),
          totalFranchisees: MigrationTransformer.number(franchise.total_franchise, { defaultValue: 0 }),
          countryOfOrigin: 'India',
          
          // Investment details
          investment: {
            investmentRange: {
              min: { amount: minInvestment, currency: 'INR' },
              max: { amount: maxInvestment, currency: 'INR' },
              formattedRange: `₹${minInvestment.toLocaleString()} - ₹${maxInvestment.toLocaleString()}`
            },
            franchiseFee: {
              amount: franchiseFormats.length > 0 
                ? MigrationTransformer.number(franchiseFormats[0].brand_fee, { defaultValue: 0 })
                : 0,
              currency: 'INR',
              refundable: false
            }
          },
          
          // Terms and conditions
          terms: {
            contractDuration: {
              years: MigrationTransformer.number(franchise.term_duration_year, { defaultValue: 0 }),
              renewalOption: franchise.is_term_renewable === 1
            },
            renewalTerms: {
              available: franchise.is_term_renewable === 1
            },
            spaceRequirement: {
              minArea: franchiseFormats.length > 0 
                ? `${MigrationTransformer.number(franchiseFormats[0].space_min, { defaultValue: 0 })} sq ft`
                : '',
              maxArea: franchiseFormats.length > 0 
                ? `${MigrationTransformer.number(franchiseFormats[0].space_max, { defaultValue: 0 })} sq ft`
                : ''
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
                details: franchise.assistance || ''
              },
              marketingSupport: {
                available: true,
                materials: [],
                campaigns: []
              }
            }
          },
          
          // Performance metrics
          performance: {
            salesData: {
              averageUnitSales: { 
                amount: franchiseFormats.length > 0 
                  ? MigrationTransformer.number(franchiseFormats[0].monthly_sales, { defaultValue: 0 })
                  : 0, 
                currency: 'INR' 
              }
            },
            profitability: {
              averageProfitMargin: franchiseFormats.length > 0 
                ? `${MigrationTransformer.number(franchiseFormats[0].profit_margin, { defaultValue: 0 })}%`
                : ''
            }
          }
        }
      };
      
      return extendedListing;
    },

    /**
     * Transform an investor listing
     * @param {Object} investor - Investor data from SQL
     * @param {Object} baseListing - Base listing object
     * @param {Object} context - Related context
     * @returns {Object} - Transformed investor listing
     */
    investorListing: (investor, baseListing, context = {}) => {
      const { 
        cityMap = {},
        sub_industries = [],
        investor_sub_industries = [],
        investor_location_preference = []
      } = context;
      
      // Get city data
      const cityId = investor.city_id || null;
      const city = cityId && cityMap[cityId] ? cityMap[cityId] : null;
      
      // Process investor sub-industries
      const investorSubIndustries = investor_sub_industries
        .filter(item => item.investor_id === investor.id)
        .map(item => item.sub_industry_id)
        .filter(Boolean);
      
      // Get sub-industry data and corresponding industry IDs
      const subIndustryEntities = investorSubIndustries
        .map(id => sub_industries.find(si => si.id === id))
        .filter(Boolean);
      
      const industryIds = [...new Set(subIndustryEntities
        .map(si => si.industry_id)
        .filter(Boolean))];
      
      // Process investor location preferences
      const investorLocations = investor_location_preference
        .filter(item => item.investor_id === investor.id)
        .map(item => {
          const locationCity = cityMap[item.city_id];
          return locationCity ? locationCity.name : '';
        })
        .filter(Boolean);
      
      // Process featured image
      const featuredImage = investor.cover_image ? {
        url: investor.cover_image,
        path: `listings/${baseListing.id}/featured_image`,
        alt: baseListing.name,
        width: 0,
        height: 0
      } : null;
      
      // Location object
      const location = MigrationTransformer.location({
        country: 'India',
        state: '',
        city: city ? city.name : '',
        address: '',
        pincode: '',
      });
      
      // Extend the base listing with investor-specific fields
      const extendedListing = {
        ...baseListing,
        
        // Update media
        media: {
          ...baseListing.media,
          featuredImage: featuredImage || {},
          documents: [{
            url: investor.business_proof || '',
            path: `listings/${baseListing.id}/documents/business_proof`,
            name: 'Business Proof',
            type: 'pdf',
            size: 0,
            isPublic: false
          }].filter(doc => doc.url)
        },
        
        // Location
        location: location,
        
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
            facebook: { url: '', handle: '', verified: false },
            twitter: { url: '', handle: '', verified: false },
            instagram: { url: '', handle: '', verified: false },
            linkedin: { 
              url: investor.linkedin_profile || '', 
              handle: '', 
              verified: false 
            }
          }
        },
        
        // Classification
        industries: industryIds,
        subIndustries: investorSubIndustries,
        tags: [],
        
        // Premium/featured status
        featured: investor.is_premium === 1,
        
        // Display settings
        displaySettings: {
          highlight: investor.is_hot === 1,
          badge: investor.is_premium === 1 ? 'premium' : '',
          pageOrder: investor.page_order || 0,
          showContactInfo: true,
          showAnalytics: investor.is_premium === 1
        },
        
        // Investor-specific details
        investorDetails: {
          investorType: investor.investor_preference || '',
          investmentPhilosophy: investor.factors || '',
          experience: {
            backgroundSummary: investor.about || ''
          },
          
          // Investment details
          investment: {
            capacity: {
              minInvestment: { 
                amount: MigrationTransformer.number(investor.investment_min, { defaultValue: 0 }), 
                currency: 'INR' 
              },
              maxInvestment: { 
                amount: MigrationTransformer.number(investor.investment_max, { defaultValue: 0 }), 
                currency: 'INR' 
              },
              totalFundsAvailable: { 
                amount: MigrationTransformer.number(investor.investment_max, { defaultValue: 0 }), 
                currency: 'INR' 
              }
            },
            preferences: {
              averageInvestment: { 
                amount: investor.investment_min && investor.investment_max 
                  ? Math.floor((
                      MigrationTransformer.number(investor.investment_min, { defaultValue: 0 }) + 
                      MigrationTransformer.number(investor.investment_max, { defaultValue: 0 })
                    ) / 2) 
                  : 0, 
                currency: 'INR' 
              },
              stakeSought: {
                max: MigrationTransformer.number(investor.investment_stake, { defaultValue: 0 }),
                controlling: MigrationTransformer.number(investor.investment_stake, { defaultValue: 0 }) > 50
              }
            }
          },
          
          // Focus areas
          focus: {
            industries: {
              primary: industryIds,
              secondary: [],
              excluded: []
            },
            businessCriteria: {
              size: investor.puchasing_min && investor.puchasing_max
                ? [`${investor.puchasing_min} - ${investor.puchasing_max} Cr`]
                : []
            },
            geographicFocus: investorLocations
          },
          
          // Portfolio (placeholder)
          portfolio: {
            overview: {
              totalInvestments: 0,
              activeInvestments: 0,
              exits: 0
            }
          }
        }
      };
      
      return extendedListing;
    },

    /**
     * Transform a user entity
     * @param {Object} user - User data from SQL
     * @param {Object} context - Related context
     * @returns {Object} - Transformed user for Firestore
     */
    user: (user, context = {}) => {
      if (!user) {
        throw new Error('No user data provided for transformation');
      }
      
      const { login_history = [], user_plans = [] } = context;
      
      // Generate UUID for the user
      const userId = getOrCreateUUID('users', user.id);
      
      // Find user's login history
      const userLoginHistory = login_history.filter(log => log.user_id === user.id);
      
      // Get last login timestamp
      let lastLogin = null;
      if (userLoginHistory.length > 0) {
        const sortedLogins = userLoginHistory.sort((a, b) => {
          return new Date(b.date_login) - new Date(a.date_login);
        });
        lastLogin = sortedLogins[0].date_login;
      }
      
      // Find user's subscription plans
      const userSubscriptionPlans = user_plans.filter(plan => plan.user_id === user.id);
      
      // Determine current plan if any
      let currentPlan = null;
      if (userSubscriptionPlans.length > 0) {
        const activePlans = userSubscriptionPlans.filter(plan => plan.status === 1);
        if (activePlans.length > 0) {
          const mostRecentPlan = activePlans.sort((a, b) => {
            return new Date(b.plan_activate_date) - new Date(a.plan_activate_date);
          })[0];
          
          currentPlan = {
            id: getUUID('plans', mostRecentPlan.plan_id),
            startDate: MigrationTransformer.date(mostRecentPlan.plan_activate_date),
            status: mostRecentPlan.status === 1 ? 'active' : 'expired'
          };
        }
      }
      
      // Map user role
      let userRole = 'user';
      if (user.user_role) {
        const roleLower = user.user_role.toLowerCase();
        if (ValidationConfig.VALIDATION_RULES.USERS.ROLES.includes(roleLower)) {
          userRole = roleLower;
        }
      }
      
      // Map user status
      let status = 'active';
      if (user.user_status) {
        status = user.user_status.toLowerCase() === 'blocked' ? 'suspended' : user.user_status.toLowerCase();
      }
      
      // Build transformed user
      const transformedUser = {
        // Auth Info
        uid: userId,
        email: MigrationTransformer.email(user.email),
        emailVerified: user.is_email_verified === 1,
        phoneNumber: MigrationTransformer.phone(user.mobile),
        phoneVerified: user.is_mobile_verified === 1,
        
        // Profile
        displayName: MigrationTransformer.text(
          user.full_name || `${user.f_name || ''} ${user.l_name || ''}`.trim(),
          { defaultValue: '' }
        ),
        firstName: MigrationTransformer.text(user.f_name),
        lastName: MigrationTransformer.text(user.l_name),
        profileImage: user.profile_image ? {
          url: user.profile_image,
          path: `users/${userId}/profile_image`,
          uploadedAt: MigrationTransformer.date(user.joining_date) || new Date()
        } : null,
        
        // Location
        location: MigrationTransformer.location({
          address: user.address || '',
          city: user.city_name || '',
          state: user.state || '',
          pincode: user.pincode || '',
          country: user.country || 'India'
        }),
        
        // Account status
        status: status,
        lastLogin: MigrationTransformer.date(lastLogin || user.joining_date) || new Date(),
        accountCompleteness: user.signup_complete === 1 ? 100 : 50,
        
        // Role & permissions
        role: userRole,
        permissions: [],
        
        // Subscription
        currentPlan: currentPlan,
        
        // Timestamps
        createdAt: MigrationTransformer.date(user.joining_date) || new Date(),
        updatedAt: MigrationTransformer.date(user.activate_date || user.joining_date) || new Date(),
        emailVerifiedAt: user.is_email_verified === 1 
          ? MigrationTransformer.date(user.activate_date || user.joining_date)
          : null,
        phoneVerifiedAt: user.is_mobile_verified === 1 
          ? MigrationTransformer.date(user.activate_date || user.joining_date)
          : null,
        suspendedAt: user.block_date 
          ? MigrationTransformer.date(user.block_date)
          : null
      };
      
      return transformedUser;
    },

    /**
     * Transform a plan entity
     * @param {Object} plan - Plan data from SQL
     * @param {Object} context - Related context
     * @returns {Object} - Transformed plan for Firestore
     */
    plan: (plan, context = {}) => {
      if (!plan) {
        throw new Error('No plan data provided for transformation');
      }
      
      const { plan_features = [] } = context;
      
      // Generate UUID for the plan
      const planId = getOrCreateUUID('plans', plan.id);
      
      // Find plan features
      const features = plan_features
        .filter(feature => feature.plan_id === plan.id)
        .map(feature => feature.features_name)
        .filter(Boolean);
      
      // Map plan type to standard types
      let planType = 'basic';
      if (plan.plan_type) {
        const planTypeLower = plan.plan_type.toLowerCase();
        if (planTypeLower.includes('premium')) {
          planType = 'premium';
        } else if (planTypeLower.includes('standard')) {
          planType = 'standard';
        } else if (planTypeLower.includes('free')) {
          planType = 'free';
        } else if (planTypeLower.includes('business')) {
          planType = 'business';
        }
      }
      
      // Parse amount from string to number
      const amount = MigrationTransformer.number(plan.amount, { 
        parseString: true,
        defaultValue: 0
      });
      
      // Calculate price per month
      const durationMonths = MigrationTransformer.number(plan.duration_months, { defaultValue: 1 });
      const pricePerMonth = durationMonths > 0 
        ? Math.round(amount / durationMonths) 
        : amount;
      
      // Build transformed plan
      const transformedPlan = {
        id: planId,
        name: MigrationTransformer.text(plan.name),
        type: planType,
        features: features,
        
        // Pricing
        pricing: {
          amount: amount,
          currency: 'INR',
          billingCycle: durationMonths === 1 ? 'monthly' : 
                        durationMonths === 3 ? 'quarterly' :
                        durationMonths === 6 ? 'biannual' : 'annual',
          pricePerMonth: pricePerMonth
        },
        
        // Duration
        duration: {
          displayText: `${durationMonths} month${durationMonths > 1 ? 's' : ''}`,
          days: durationMonths * 30,
          months: durationMonths
        },
        
        // Resource limits
        limits: {
          connectsPerMonth: MigrationTransformer.number(plan.send_limit, { defaultValue: 0 }),
          totalConnects: MigrationTransformer.number(plan.send_limit, { defaultValue: 0 }),
          views: {
            details: MigrationTransformer.number(plan.reveal_limit, { defaultValue: 0 }),
            contacts: MigrationTransformer.number(plan.reveal_limit, { defaultValue: 0 })
          }
        },
        
        // Display settings
        display: {
          color: planType === 'premium' ? '#FFD700' : 
                 planType === 'standard' ? '#0031AC' : 
                 planType === 'basic' ? '#4CAF50' : '#9E9E9E',
          badge: planType,
          recommended: planType === 'standard',
          highlight: planType === 'premium'
        },
        
        // Availability
        availability: {
          isPublic: plan.status === 1
        },
        
        // Permissions
        permissions: {
          canMessage: plan.send_limit > 0,
          canExport: planType === 'premium',
          canAccessAdvancedSearch: planType !== 'free',
          showAnalytics: plan.show_stats === 1,
          hideAds: planType === 'premium',
          priority: {
            support: planType === 'premium',
            visibility: plan.promotion_priority > 0
          }
        },
        
        // Status
        status: plan.status === 1,
        
        // Timestamps
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      return transformedPlan;
    }
  };

  /**
   * Validation functions (namespace)
   */
  static validate = {
    /**
     * Validate listing against schema
     * @param {Object} listing - Listing data
     * @param {string} type - Listing type
     * @returns {Object} - Validation result
     */
    listing: (listing, type) => {
      // Get required fields for this listing type
      const requiredFields = ValidationConfig.VALIDATION_RULES.LISTINGS.REQUIRED_FIELDS[type] || [];
      
      // Validation errors
      const errors = [];
      
      // Check required fields
      for (const field of requiredFields) {
        const value = field.includes('.') 
          ? field.split('.').reduce((obj, key) => obj?.[key], listing)
          : listing[field];
          
        if (value === undefined || value === null || value === '') {
          errors.push(`Required field '${field}' is missing`);
        }
      }
      
      // Check if type is valid
      if (!ValidationConfig.VALIDATION_RULES.LISTINGS.TYPES.includes(type)) {
        errors.push(`Invalid listing type: ${type}`);
      }
      
      return {
        isValid: errors.length === 0,
        errors,
        type
      };
    },

    /**
     * Validate user against schema
     * @param {Object} user - User data
     * @returns {Object} - Validation result
     */
    user: (user) => {
      // Required fields
      const requiredFields = ValidationConfig.VALIDATION_RULES.USERS.REQUIRED_FIELDS;
      
      // Validation errors
      const errors = [];
      
      // Check required fields
      for (const field of requiredFields) {
        if (!user[field]) {
          errors.push(`Required field '${field}' is missing`);
        }
      }
      
      // Validate email format
      if (user.email && !MigrationTransformer.email(user.email, { validateFormat: true })) {
        errors.push(`Invalid email format: ${user.email}`);
      }
      
      // Validate role
      if (user.user_role && !ValidationConfig.VALIDATION_RULES.USERS.ROLES.includes(user.user_role.toLowerCase())) {
        errors.push(`Invalid user role: ${user.user_role}`);
      }
      
      return {
        isValid: errors.length === 0,
        errors
      };
    },

    /**
     * Validate plan against schema
     * @param {Object} plan - Plan data
     * @returns {Object} - Validation result
     */
    plan: (plan) => {
      // Required fields
      const requiredFields = ValidationConfig.VALIDATION_RULES.PLANS.REQUIRED_FIELDS;
      
      // Validation errors
      const errors = [];
      
      // Check required fields
      for (const field of requiredFields) {
        if (!plan[field]) {
          errors.push(`Required field '${field}' is missing`);
        }
      }
      
      return {
        isValid: errors.length === 0,
        errors
      };
    }
  };

  /**
   * Error handling functions (namespace)
   */
  static error = {
    /**
     * Log an error with context
     * @param {Error} error - Error object
     * @param {Object} context - Error context
     */
    log: (error, context = {}) => {
      MigrationTransformer.logError(error, context);
    },

    /**
     * Handle a migration error
     * @param {Error} error - Error object
     * @param {Object} context - Error context
     * @returns {null} - Returns null to indicate error
     */
    handle: (error, context = {}) => {
      MigrationTransformer.logError(error, context);
      return null;
    }
  };

  /**
   * Map status string to standardized status
   * @param {string|number} status - Status from SQL
   * @returns {string} - Standardized status
   */
  static mapStatus(status) {
    if (status === undefined || status === null) {
      return 'active';
    }

    if (typeof status === 'number') {
      return status === 1 ? 'active' : 'inactive';
    }

    const statusLower = String(status).toLowerCase();
    
    if (['active', 'enabled', '1'].includes(statusLower)) {
      return 'active';
    } else if (['inactive', 'disabled', '0'].includes(statusLower)) {
      return 'inactive';
    } else if (['pending', 'awaiting'].includes(statusLower)) {
      return 'pending';
    } else if (['deleted', 'removed'].includes(statusLower)) {
      return 'deleted';
    } else if (['featured', 'premium'].includes(statusLower)) {
      return 'featured';
    } else if (['sold', 'completed'].includes(statusLower)) {
      return 'sold';
    }
    
    return statusLower;
  }
}

module.exports = MigrationStrategy;
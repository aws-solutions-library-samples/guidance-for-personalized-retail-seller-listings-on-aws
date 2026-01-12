/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
const AWS = require('aws-sdk');
const s3 = new AWS.S3();

/**
 * Lambda function to serve product data from S3
 */
exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  try {
    // Get the bucket name from environment variables
    const bucketName = process.env.STRUCTURED_DATA_BUCKET;
    
    // Check if the bucket name is provided
    if (!bucketName) {
      console.error('STRUCTURED_DATA_BUCKET environment variable is not set');
      return formatResponse(500, { error: 'Internal server error' });
    }
    
    // Get the HTTP method and path parameters
    const httpMethod = event.httpMethod;
    const pathParameters = event.pathParameters || {};
    
    // Handle GET requests
    if (httpMethod === 'GET') {
      // If productId is provided, get specific product data
      if (pathParameters.productId) {
        const productId = pathParameters.productId;
        console.log(`Getting product data for productId: ${productId}`);
        
        // Construct the S3 key for the product data
        const key = `products/${productId}/${productId}.json`;
        
        try {
          // Get the product data from S3
          const data = await s3.getObject({
            Bucket: bucketName,
            Key: key
          }).promise();
          
          // Parse the JSON data
          const productData = JSON.parse(data.Body.toString('utf-8'));
          
          // Filter the images array to only include the id property
          if (productData.images && Array.isArray(productData.images)) {
            productData.images = productData.images.map(image => {
              // Keep only the id property
              return { id: image.id };
            });
          }
          
          // Add cache control headers for performance optimization
          const headers = {
            'Content-Type': 'application/json',
            'Cache-Control': 'max-age=3600', // Cache for 1 hour
          };
          
          return formatResponse(200, productData, headers);
        } catch (error) {
          // Handle case where the product data doesn't exist
          if (error.code === 'NoSuchKey') {
            console.error(`Product data not found for productId: ${productId}`);
            return formatResponse(404, { error: 'Product not found' });
          }
          
          // Handle other S3 errors
          console.error('Error getting product data from S3:', error);
          return formatResponse(500, { error: 'Internal server error' });
        }
      } else {
        // List all products
        console.log('Listing all products');
        
        try {
          // List objects in the products/ prefix
          const data = await s3.listObjects({
            Bucket: bucketName,
            Prefix: 'products/'
          }).promise();
          
          // Extract product IDs from the keys
          const productIds = data.Contents.map(item => {
            const key = item.Key;
            // Extract productId from the key (products/{productId}/{productId}.json)
            const match = key.match(/products\/([^\/]+)\/\1\.json$/);
            return match ? match[1] : null;
          }).filter(id => id !== null);
          
          // Fetch basic details for each product
          const productDetailsPromises = productIds.map(async (productId) => {
            try {
              // Construct the S3 key for the product data
              const key = `products/${productId}/${productId}.json`;
              
              // Get the product data from S3
              const data = await s3.getObject({
                Bucket: bucketName,
                Key: key
              }).promise();
              
              // Parse the JSON data
              const fullProductData = JSON.parse(data.Body.toString('utf-8'));
              
              // Extract only the basic details needed for listing
              return {
                id: productId,
                name: fullProductData.name || `Product ${productId}`,
                brand: fullProductData.brand,
                description: fullProductData.description,
                // Include a few more fields that might be useful for listing
                model_number: fullProductData.model_number,
                features: Array.isArray(fullProductData.features) ? 
                  fullProductData.features.slice(0, 3) : // Only include first 3 features
                  undefined
              };
            } catch (error) {
              console.error(`Error fetching details for product ${productId}:`, error);
              // Return minimal product object if fetch fails
              return {
                id: productId,
                name: `Product ${productId}`,
                description: 'Product details could not be loaded.'
              };
            }
          });
          
          // Wait for all product details to be fetched
          const productDetails = await Promise.all(productDetailsPromises);
          
          // Add cache control headers for performance optimization
          const headers = {
            'Content-Type': 'application/json',
            'Cache-Control': 'max-age=300', // Cache for 5 minutes
          };
          
          return formatResponse(200, { products: productDetails }, headers);
        } catch (error) {
          console.error('Error listing products from S3:', error);
          return formatResponse(500, { error: 'Internal server error' });
        }
      }
    }
    
    // Handle DELETE requests
    if (httpMethod === 'DELETE') {
      // If productId is provided, delete specific product data
      if (pathParameters.productId) {
        const productId = pathParameters.productId;
        console.log(`Deleting product data for productId: ${productId}`);
        
        try {
          // First, get the product data to find associated images
          const key = `products/${productId}/${productId}.json`;
          let productData;
          
          try {
            // Get the product data from S3
            const data = await s3.getObject({
              Bucket: bucketName,
              Key: key
            }).promise();
            
            // Parse the JSON data
            productData = JSON.parse(data.Body.toString('utf-8'));
          } catch (error) {
            // If the product doesn't exist, return 404
            if (error.code === 'NoSuchKey') {
              console.error(`Product data not found for productId: ${productId}`);
              return formatResponse(404, { error: 'Product not found' });
            }
            
            // For other errors, continue with deletion anyway
            console.error('Error getting product data from S3:', error);
          }
          
          // Delete product data file
          await s3.deleteObject({
            Bucket: bucketName,
            Key: key
          }).promise();
          
          // Delete associated images if they exist
          if (productData && productData.images && Array.isArray(productData.images)) {
            for (const image of productData.images) {
              if (image.path) {
                try {
                  await s3.deleteObject({
                    Bucket: bucketName,
                    Key: image.path
                  }).promise();
                  console.log(`Deleted image: ${image.path}`);
                } catch (imageError) {
                  console.error(`Error deleting image ${image.path}:`, imageError);
                  // Continue with other deletions even if one fails
                }
              }
            }
          }
          
          // Return success response
          return formatResponse(200, { 
            message: `Product ${productId} deleted successfully`,
            productId
          });
        } catch (error) {
          console.error(`Error deleting product ${productId}:`, error);
          return formatResponse(500, { error: 'Failed to delete product' });
        }
      } else {
        // Missing productId
        return formatResponse(400, { error: 'Product ID is required' });
      }
    }
    
    // Handle unsupported HTTP methods
    return formatResponse(405, { error: 'Method not allowed' });
  } catch (error) {
    console.error('Unexpected error:', error);
    return formatResponse(500, { error: 'Internal server error' });
  }
};

/**
 * Helper function to format the API Gateway response
 * @param {number} statusCode - HTTP status code
 * @param {object} body - Response body
 * @param {object} headers - Additional headers
 * @returns {object} - Formatted response
 */
function formatResponse(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*', // CORS header
      'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
      ...headers
    },
    body: JSON.stringify(body)
  };
}

/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
const AWS = require('aws-sdk');
const s3 = new AWS.S3();

/**
 * Lambda function to generate presigned URLs for product images
 * 
 * This function locates images in S3 and returns a presigned URL for direct access
 * It supports both raw uploaded images and processed images
 */
exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  try {
    // Get productId and imageId from path parameters
    const productId = event.pathParameters?.productId;
    const imageId = event.pathParameters?.imageId;
    
    if (!productId || !imageId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required parameters: productId and imageId' }),
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*', // CORS header
        },
      };
    }
    
    // Get bucket names from environment variables
    const rawFilesBucket = process.env.RAW_FILES_BUCKET;
    const structuredDataBucket = process.env.STRUCTURED_DATA_BUCKET;
    
    // First, try to get image metadata from the product data
    const productDataKey = `products/${productId}/${productId}.json`;
    let productData;
    let imageMetadata;
    
    try {
      const productDataResponse = await s3.getObject({
        Bucket: structuredDataBucket,
        Key: productDataKey,
      }).promise();
      
      productData = JSON.parse(productDataResponse.Body.toString('utf-8'));
      
      // Find the image metadata in the product data
      if (productData.images && Array.isArray(productData.images)) {
        imageMetadata = productData.images.find(img => img.id === imageId);
      }
    } catch (error) {
      console.log('Error fetching product data or image metadata not found:', error);
      // Continue without metadata - we'll try to find the image directly
    }
    
    // Determine the image path based on metadata or use default paths
    let imagePath;
    let bucket;
    
    if (imageMetadata && imageMetadata.path) {
      // If we have metadata with a path, use it
      imagePath = imageMetadata.path;
      bucket = imageMetadata.path.startsWith('raw/') ? rawFilesBucket : structuredDataBucket;
    } else {
      // Try standard locations
      // First check in the structured data bucket (processed images)
      // Look for images with the pattern {imageId}-{filename}
      imagePath = `products/${productId}/images/${imageId}`;
      
      // If the imageId doesn't contain a filename, try to list objects in the directory
      if (!imagePath.includes('.')) {
        try {
          const listParams = {
            Bucket: structuredDataBucket,
            Prefix: `products/${productId}/images/${imageId}-`
          };
          
          const listResult = await s3.listObjectsV2(listParams).promise();
          if (listResult.Contents && listResult.Contents.length > 0) {
            // Use the first matching object
            imagePath = listResult.Contents[0].Key;
          }
        } catch (error) {
          console.log(`Error listing images with prefix ${imageId}: ${error.message}`);
          // Continue with the original path
        }
      }
      
      bucket = structuredDataBucket;
      
      try {
        // Check if the image exists in the structured data bucket
        await s3.headObject({
          Bucket: bucket,
          Key: imagePath,
        }).promise();
      } catch (error) {
        // If not found, try the raw files bucket
        imagePath = `${productId}/images/${imageId}`;
        bucket = rawFilesBucket;
        
        try {
          // Check if the image exists in the raw files bucket
          await s3.headObject({
            Bucket: bucket,
            Key: imagePath,
          }).promise();
        } catch (error) {
          // If still not found, try another common pattern
          imagePath = `uploads/${productId}/${imageId}`;
          bucket = rawFilesBucket;
          
          try {
            await s3.headObject({
              Bucket: bucket,
              Key: imagePath,
            }).promise();
          } catch (error) {
            // Image not found in any expected location
            return {
              statusCode: 404,
              body: JSON.stringify({ error: 'Image not found' }),
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            };
          }
        }
      }
    }
    
    // Determine content type
    let contentType;
    
    if (imageMetadata?.contentType) {
      contentType = imageMetadata.contentType;
    } else {
      // Infer from file extension
      if (imagePath.toLowerCase().endsWith('.jpg') || imagePath.toLowerCase().endsWith('.jpeg')) {
        contentType = 'image/jpeg';
      } else if (imagePath.toLowerCase().endsWith('.png')) {
        contentType = 'image/png';
      } else if (imagePath.toLowerCase().endsWith('.gif')) {
        contentType = 'image/gif';
      } else if (imagePath.toLowerCase().endsWith('.webp')) {
        contentType = 'image/webp';
      } else if (imagePath.toLowerCase().endsWith('.svg')) {
        contentType = 'image/svg+xml';
      } else {
        contentType = 'application/octet-stream';
      }
    }
    
    // Generate a presigned URL for the image (valid for 15 minutes)
    const presignedUrl = s3.getSignedUrl('getObject', {
      Bucket: bucket,
      Key: imagePath,
      Expires: 900, // 15 minutes in seconds
      ResponseContentType: contentType, // Ensure correct content type
    });
    
    console.log('Generated presigned URL for image:', presignedUrl);
    
    // Return the presigned URL in a JSON response
    return {
      statusCode: 200,
      body: JSON.stringify({
        url: presignedUrl,
        contentType: contentType,
        expiresIn: 900, // 15 minutes in seconds
      }),
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, max-age=0', // Don't cache the URL response
        'Access-Control-Allow-Origin': '*',
      },
    };
    
  } catch (error) {
    console.error('Error:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    };
  }
};

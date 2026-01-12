/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const bedrock = new AWS.BedrockRuntime();

// Environment variables
const STRUCTURED_DATA_BUCKET = process.env.STRUCTURED_DATA_BUCKET;
const JOB_TRACKING_TABLE = process.env.JOB_TRACKING_TABLE;
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-3-7-sonnet-20250219-v1:0';

/**
 * Lambda function to merge product data from multiple documents
 * This function is triggered by EventBridge events when all files for a job have been processed
 */
exports.handler = async (event) => {
  console.log('Processing event:', JSON.stringify(event, null, 2));
  
  try {
    // Extract parameters from the event
    const { jobId, productId, isNew } = event.detail;
    
    if (!jobId || !productId) {
      throw new Error('Missing required parameters: jobId or productId');
    }
    
    // Update job status to "Merging"
    await updateJobStatus(jobId, 'Merging', {
      mergeStartTime: new Date().toISOString(),
      detail: 'Collecting and merging data from all processed files'
    });

    // Get job details to find all processed files
    const jobDetails = await getJobDetails(jobId);
    if (!jobDetails) {
      throw new Error(`Job not found: ${jobId}`);
    }

    // Collect all processed data files for this job
    const processedFiles = await collectProcessedFiles(jobId, productId);
    console.log(`Found ${processedFiles.length} processed files for job ${jobId}`);

    if (processedFiles.length === 0) {
      throw new Error(`No processed files found for job ${jobId}`);
    }

    // Extract the raw data from each file
    const extractedDataArray = processedFiles.map(file => {
      return {
        source: file.key,
        data: file.content.extractedData
      };
    });

    let mergedData;
    
    // Handle differently based on whether this is a new product or an update to an existing one
    const isNewProduct = isNew !== false; // Default to true if not specified
    
    if (isNewProduct) {
      // For new products, merge data from all uploaded documents
      console.log('Processing as new product');
      mergedData = await mergeDataWithBedrock(extractedDataArray, productId, null);
    } else {
      // For existing products, retrieve existing data and merge with new data
      console.log('Processing as update to existing product');
      const existingProductData = await getExistingProductData(productId);
      mergedData = await mergeDataWithBedrock(extractedDataArray, productId, existingProductData);
    }
    
    // Store the merged data
    const mergedDataPath = await storeMergedData(jobId, productId, mergedData);
    
    // Update job status to "Completed"
    await updateJobStatus(jobId, 'Completed', {
      mergeCompletionTime: new Date().toISOString(),
      mergedDataPath
      // Removed 'status' field to avoid conflict with the main status parameter
    });
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        jobId,
        productId,
        mergedDataPath,
        message: 'Product data merged successfully'
      })
    };
  } catch (error) {
    console.error('Error processing event:', error);
    
    // Update job status to "Error"
    try {
      const { jobId } = event.detail;
      if (jobId) {
        await updateJobStatus(jobId, 'Failed', {
          error: error.message,
          errorTime: new Date().toISOString()
        });
      }
    } catch (updateError) {
      console.error('Error updating job status:', updateError);
    }
    
    throw error;
  }
};

/**
 * Get job details from DynamoDB
 */
async function getJobDetails(jobId) {
  if (!JOB_TRACKING_TABLE) {
    console.warn('JOB_TRACKING_TABLE environment variable not set, skipping job details lookup');
    return null;
  }
  
  try {
    const params = {
      TableName: JOB_TRACKING_TABLE,
      KeyConditionExpression: 'jobId = :jobId',
      ExpressionAttributeValues: {
        ':jobId': jobId
      },
      Limit: 1
    };
    
    const result = await dynamoDB.query(params).promise();
    
    if (result.Items && result.Items.length > 0) {
      return result.Items[0];
    }
    
    return null;
  } catch (error) {
    console.error(`Error getting job details: ${error.message}`);
    return null;
  }
}

/**
 * Update the job status in DynamoDB
 */
async function updateJobStatus(jobId, status, additionalData = {}) {
  if (!JOB_TRACKING_TABLE) {
    console.warn('JOB_TRACKING_TABLE environment variable not set, skipping status update');
    return;
  }
  
  console.log(`Updating job ${jobId} status to ${status}`);
  
  let updateExpression = 'SET #status = :status, updatedAt = :updatedAt';
  const expressionAttributeNames = {
    '#status': 'status'
  };
  const expressionAttributeValues = {
    ':status': status,
    ':updatedAt': new Date().toISOString()
  };
  
  // Add additional data to the update expression
  let counter = 0;
  for (const [key, value] of Object.entries(additionalData)) {
    const attributeName = `#attr${counter}`;
    const attributeValue = `:val${counter}`;
    
    updateExpression += `, ${attributeName} = ${attributeValue}`;
    expressionAttributeNames[attributeName] = key;
    expressionAttributeValues[attributeValue] = value;
    
    counter++;
  }
  
  const params = {
    TableName: JOB_TRACKING_TABLE,
    Key: {
      jobId: jobId,
      createdAt: await getJobCreatedAt(jobId) // We need the sort key
    },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: 'UPDATED_NEW'
  };
  
  try {
    const result = await dynamoDB.update(params).promise();
    console.log(`Job status updated: ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    console.error(`Error updating job status: ${error.message}`);
    // Don't throw the error, as this is a non-critical operation
    return null;
  }
}

/**
 * Get the createdAt timestamp for a job (needed as the sort key for DynamoDB)
 */
async function getJobCreatedAt(jobId) {
  if (!JOB_TRACKING_TABLE) {
    return new Date().toISOString(); // Fallback if table not set
  }
  
  try {
    const params = {
      TableName: JOB_TRACKING_TABLE,
      KeyConditionExpression: 'jobId = :jobId',
      ExpressionAttributeValues: {
        ':jobId': jobId
      },
      Limit: 1
    };
    
    const result = await dynamoDB.query(params).promise();
    
    if (result.Items && result.Items.length > 0) {
      return result.Items[0].createdAt;
    }
    
    // If job not found, return current timestamp
    return new Date().toISOString();
  } catch (error) {
    console.error(`Error getting job createdAt: ${error.message}`);
    return new Date().toISOString(); // Fallback
  }
}

/**
 * Collect all processed data files for a job
 */
async function collectProcessedFiles(jobId, productId) {
  if (!STRUCTURED_DATA_BUCKET) {
    throw new Error('STRUCTURED_DATA_BUCKET environment variable not set');
  }
  
  try {
    // List all objects in the processed directory for this job
    const params = {
      Bucket: STRUCTURED_DATA_BUCKET,
      Prefix: `processed/${jobId}/`
    };
    
    const result = await s3.listObjectsV2(params).promise();
    console.log('processed files result: ' + JSON.stringify(result))
    if (!result.Contents || result.Contents.length === 0) {
      return [];
    }
    
    // Filter for JSON files
    const jsonFiles = result.Contents.filter(obj => obj.Key.endsWith('.json'));
    
    // Get the content of each file
    const filePromises = jsonFiles.map(async (obj) => {
      const fileParams = {
        Bucket: STRUCTURED_DATA_BUCKET,
        Key: obj.Key
      };
      
      const fileData = await s3.getObject(fileParams).promise();
      const content = JSON.parse(fileData.Body.toString('utf-8'));
      
      return {
        key: obj.Key,
        content
      };
    });
    
    return await Promise.all(filePromises);
  } catch (error) {
    console.error(`Error collecting processed files: ${error.message}`);
    throw error;
  }
}

/**
 * Get existing product data from S3
 */
async function getExistingProductData(productId) {
  if (!STRUCTURED_DATA_BUCKET) {
    throw new Error('STRUCTURED_DATA_BUCKET environment variable not set');
  }
  
  try {
    const params = {
      Bucket: STRUCTURED_DATA_BUCKET,
      Key: `products/${productId}/${productId}.json`
    };
    
    const data = await s3.getObject(params).promise();
    return JSON.parse(data.Body.toString('utf-8'));
  } catch (error) {
    if (error.code === 'NoSuchKey') {
      console.warn(`No existing data found for product ${productId}, treating as new product`);
      return null;
    }
    console.error(`Error getting existing product data: ${error.message}`);
    throw error;
  }
}

/**
 * Get product data from S3
 * This function is used to get the product data that might have been stored separately
 * by the extract-product-info Lambda, particularly for image metadata
 */
async function getProductData(productId) {
  if (!STRUCTURED_DATA_BUCKET) {
    throw new Error('STRUCTURED_DATA_BUCKET environment variable not set');
  }
  
  try {
    const params = {
      Bucket: STRUCTURED_DATA_BUCKET,
      Key: `products/${productId}/${productId}.json`
    };
    
    const response = await s3.getObject(params).promise();
    return JSON.parse(response.Body.toString('utf-8'));
  } catch (error) {
    if (error.code === 'NoSuchKey') {
      console.log(`No product data found for ${productId}`);
      return null;
    }
    console.error(`Error getting product data: ${error.message}`);
    return null;
  }
}

/**
 * Merge data from multiple sources using Bedrock
 * @param {Array} extractedDataArray - Array of extracted data objects
 * @param {string} productId - Product ID
 * @param {Object} existingProductData - Existing product data (null for new products)
 */
async function mergeDataWithBedrock(extractedDataArray, productId, existingProductData) {
  // Get any image metadata that might have been stored separately
  const productData = await getProductData(productId);
  const imageMetadata = productData?.images || [];
  try {
    // Create a prompt for Bedrock to merge the data
    const prompt = createMergePrompt(extractedDataArray, productId, existingProductData);
    
    // Call Bedrock to merge the data
    const bedrockParams = {
      modelId: BEDROCK_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt
              }
            ]
          }
        ]
      })
    };
    
    console.log('Calling Bedrock with params:', JSON.stringify(bedrockParams, null, 2));
    
    const bedrockResponse = await bedrock.invokeModel(bedrockParams).promise();
    const responseBody = JSON.parse(new TextDecoder().decode(bedrockResponse.body));
    
    console.log('Bedrock response:', JSON.stringify(responseBody, null, 2));
    
    // Extract the merged data from the response
    // Handle both old and new response formats
    let mergedDataText;
    if (responseBody.content && Array.isArray(responseBody.content)) {
      // New format (Claude 3)
      const textContent = responseBody.content.find(item => item.type === 'text');
      if (textContent) {
        mergedDataText = textContent.text;
      } else {
        throw new Error('No text content found in Bedrock response');
      }
    } else if (responseBody.completion) {
      // Old format (Claude 2)
      mergedDataText = responseBody.completion;
    } else {
      throw new Error('Unexpected Bedrock response format');
    }
    
    // Find the JSON object in the response
    const jsonMatch = mergedDataText.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch || !jsonMatch[1]) {
      throw new Error('Failed to extract JSON from Bedrock response');
    }
    
    const mergedData = JSON.parse(jsonMatch[1]);
    
    // For images, we want to prioritize the properly formatted images from the extract-product-info Lambda
    // These have IDs starting with "img-" and paths starting with "products/"
    if (imageMetadata && imageMetadata.length > 0) {
      console.log(`Found ${imageMetadata.length} images in product data`);
      
      // Filter out images that don't have the correct format
      const properlyFormattedImages = imageMetadata.filter(img => 
        img.id && img.id.startsWith('img-') && 
        img.path && img.path.startsWith('products/')
      );
      
      console.log(`Found ${properlyFormattedImages.length} properly formatted images`);
      
      // If there are properly formatted images, use only those
      if (properlyFormattedImages.length > 0) {
        mergedData.images = properlyFormattedImages;
      } else {
        // If there are no properly formatted images, use the existing ones
        mergedData.images = imageMetadata;
      }
    }
    
    return mergedData;
  } catch (error) {
    console.error(`Error merging data with Bedrock: ${error.message}`);
    throw error;
  }
}

/**
 * Create a prompt for Bedrock to merge the data
 */
function createMergePrompt(extractedDataArray, productId, existingProductData) {
  // Convert the extracted data to a string representation
  const dataString = JSON.stringify(extractedDataArray, null, 2);
  
  // If there's existing product data, create a prompt for updating
  if (existingProductData) {
    return `
You are an expert product data analyst. Your task is to update existing product information with newly extracted data from additional documents.

Here is the existing product data for product ID: ${productId}:
${JSON.stringify(existingProductData, null, 2)}

Here is the newly extracted data from additional documents:
${dataString}

Please analyze both datasets and create an updated product data sheet following these rules for merging existing and new data:

1. PRESERVE existing data unless new data clearly provides more accurate or detailed information
2. SUPPLEMENT existing data with additional details from new documents
3. REPLACE outdated information with newer information from recent documents
4. PRIORITIZE specific information over generic information
5. COMBINE unique items from both sources for arrays like features and specifications
6. MAINTAIN the overall structure and format of the product data

For each field that you update, apply these specific guidelines:
- Product name and brand: Maintain consistency unless clearly incorrect
- Description: Enhance with additional details while preserving key messaging
- Features: Add new features while removing duplicates
- Specifications: Update with more precise values if provided
- Images: Preserve existing image URLs and add new ones
- Categories and keywords: Expand with relevant new terms

Return ONLY a valid JSON object with the merged product data, formatted as follows:

\`\`\`json
{
  "productId": "${productId}",
  "name": "string",
  "brand": "string",
  "model_number": "string",
  "price": "string",
  "rating": number,
  "reviewCount": number,
  "description": "string",
  "highlights": ["string"],
  "specifications": {
    "dimensions": "string",
    "weight": "string",
    "power_requirements": "string",
    "materials": "string",
    "connectivity": "string",
    "additional_specs": "string"
  },
  "features": [
    {
      "title": "string",
      "description": "string",
      "icon": "string"
    }
  ],
  "images": [
    {
      "id": "string",
      "filename": "string",
      "path": "string",
      "contentType": "string",
      "description": "string",
      "uploadedAt": "string"
    }
  ],
  "usage_instructions": "string",
  "warranty_info": "string",
  "categories": ["string"],
  "keywords": ["string"],
  "target_audience": "string",
  "release_date": "string",
  "comparison_table": {
    "key": "value"
  }
}
\`\`\`

Include only fields that have valid data. If a field is missing from all sources, omit it from the final output.
`;
  } else {
    // For new products, create a prompt for merging multiple documents
    return `
You are a product data specialist tasked with merging information from multiple documents about the same product.

I have extracted data from multiple documents for product ID: ${productId}. Each document may contain different pieces of information about the product. Your task is to merge this information into a single, comprehensive product data sheet.

Here are the extracted data sources:

${dataString}

Please follow these guidelines:
1. Merge all relevant information from all sources into a single product data structure
2. Resolve any conflicts by prioritizing the most detailed or specific information
3. Ensure all product fields are properly populated
4. If the same field has different values in different sources, use the most complete or recent information
5. For arrays (like features, specifications, etc.), combine unique items from all sources
6. Maintain the structure of the product data format

Return ONLY a valid JSON object with the merged product data, formatted as follows:

\`\`\`json
{
  "productId": "${productId}",
  "name": "string",
  "brand": "string",
  "model_number": "string",
  "price": "string",
  "rating": number,
  "reviewCount": number,
  "description": "string",
  "highlights": ["string"],
  "specifications": {
    "dimensions": "string",
    "weight": "string",
    "power_requirements": "string",
    "materials": "string",
    "connectivity": "string",
    "additional_specs": "string"
  },
  "features": [
    {
      "title": "string",
      "description": "string",
      "icon": "string"
    }
  ],
  "images": [
    {
      "id": "string",
      "filename": "string",
      "path": "string",
      "contentType": "string",
      "description": "string",
      "uploadedAt": "string"
    }
  ],
  "usage_instructions": "string",
  "warranty_info": "string",
  "categories": ["string"],
  "keywords": ["string"],
  "target_audience": "string",
  "release_date": "string",
  "comparison_table": {
    "key": "value"
  }
}
\`\`\`

Include only fields that have valid data. If a field is missing from all sources, omit it from the final output.
`;
  }
}

/**
 * Store the merged data in S3
 */
async function storeMergedData(jobId, productId, mergedData) {
  if (!STRUCTURED_DATA_BUCKET) {
    throw new Error('STRUCTURED_DATA_BUCKET environment variable not set');
  }
  
  try {
    // Add metadata to the merged data
    const enhancedData = {
      metadata: {
        jobId,
        productId,
        mergeTimestamp: new Date().toISOString(),
        sources: `processed/${jobId}/`
      },
      ...mergedData
    };
    
    // Store the merged data in the products directory
    const mergedDataPath = `products/${productId}/${productId}.json`;
    const params = {
      Bucket: STRUCTURED_DATA_BUCKET,
      Key: mergedDataPath,
      Body: JSON.stringify(enhancedData, null, 2),
      ContentType: 'application/json'
    };
    
    await s3.putObject(params).promise();
    console.log(`Merged data stored at s3://${STRUCTURED_DATA_BUCKET}/${mergedDataPath}`);
    
    return mergedDataPath;
  } catch (error) {
    console.error(`Error storing merged data: ${error.message}`);
    throw error;
  }
}

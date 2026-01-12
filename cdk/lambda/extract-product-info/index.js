/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const eventBridge = new AWS.EventBridge();
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sts = new AWS.STS();
const lambda = new AWS.Lambda();

// Environment variables
const RAW_FILES_BUCKET = process.env.RAW_FILES_BUCKET;
const STRUCTURED_DATA_BUCKET = process.env.STRUCTURED_DATA_BUCKET;
const BDA_OUTPUT_BUCKET = process.env.BDA_OUTPUT_BUCKET || process.env.RAW_FILES_BUCKET; // Use RAW_FILES_BUCKET as fallback
const JOB_TRACKING_TABLE = process.env.JOB_TRACKING_TABLE;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'default';
const BDA_DOCUMENT_BLUEPRINT_ARN = process.env.BDA_DOCUMENT_BLUEPRINT_ARN;
const BDA_IMAGE_BLUEPRINT_ARN = process.env.BDA_IMAGE_BLUEPRINT_ARN;
const BDA_DATA_PROCESSING_LAMBDA_ARN = process.env.BDA_DATA_PROCESSING_LAMBDA_ARN;
const BDA_RESULTS_LAMBDA_ARN = process.env.BDA_RESULTS_LAMBDA_ARN;

/**
 * Generates a unique image ID in the format 'img-<hex>'
 * @returns {String} - Unique image ID with alphanumeric hex ID
 */
function generateImageId() {
  // Generate a random 8-character hexadecimal string
  const hexId = Math.floor(Math.random() * 0xFFFFFFFF).toString(16).padStart(8, '0');
  
  // Return image ID in the format 'img-<hex>'
  return `img-${hexId}`;
}

/**
 * Detect the content type of a file based on its extension
 * @param {String} filePath - Path to the file
 * @returns {String} - Content type
 */
function detectContentType(filePath) {
  const extension = filePath.split('.').pop().toLowerCase();
  
  const contentTypes = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'bmp': 'image/bmp',
    'tiff': 'image/tiff',
    'tif': 'image/tiff'
  };
  
  return contentTypes[extension] || 'application/octet-stream';
}

/**
 * Lambda function to extract product information from documents and images
 * This function is called by EventBridge events
 */
exports.handler = async (event) => {
  console.log('Processing event:', JSON.stringify(event, null, 2));
  
  try {
    // Extract parameters from the event
    const { jobId, fileType, filePath } = event;
    
    if (!jobId || !fileType || !filePath) {
      throw new Error('Missing required parameters: jobId, fileType, or filePath');
    }
    
    // Update job status to "Extracting" - removed fileType as a top-level attribute
    await updateJobStatus(jobId, 'Extracting', {
      currentFile: filePath,
      startTime: new Date().toISOString()
    });

    const region = process.env.AWS_REGION;
    const accountId = await getAccountId();

    const blueprintArn = fileType.includes('image') ? BDA_IMAGE_BLUEPRINT_ARN : BDA_DOCUMENT_BLUEPRINT_ARN;
    console.log(blueprintArn);

    const dataAutomationProfileArn = `arn:aws:bedrock:${region}:${accountId}:data-automation-profile/us.data-automation-v1`;
    
    // Directly invoke the BDA processing Lambda
    const invocationArn = await invokeBDAProcessingLambda(filePath, jobId, blueprintArn, dataAutomationProfileArn);
    
    // Wait for the BDA job to complete
    const extractedData = await waitForBDAJobCompletion(invocationArn, jobId);
    
    // Store the structured data in S3
    const structuredDataPath = await storeStructuredData(jobId, filePath, fileType, extractedData);
    
    // Update job status to "Extracted" - removed fileType as a top-level attribute
    await updateJobStatus(jobId, 'Extracted', {
      currentFile: filePath,
      structuredDataPath: structuredDataPath,
      completionTime: new Date().toISOString(),
      extractionStatus: 'Success'
    });
    
    // Return the extracted data
    return {
      jobId,
      fileType,
      filePath,
      structuredDataPath,
      extractedData
    };
  } catch (error) {
    console.error('Error processing event:', error);
    
    // Update job status to "Error"
    try {
      const { jobId, filePath, fileType } = event;
      if (jobId) {
        await updateJobStatus(jobId, 'Error', {
          currentFile: filePath,
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

// Function to get account ID
async function getAccountId() {
  const { Account } = await sts.getCallerIdentity().promise();
  return Account;
}

/**
 * Directly invoke the BDA Data Processing Lambda function
 */
async function invokeBDAProcessingLambda(filePath, jobId, blueprintArn, dataAutomationProfileArn) {
  console.log(`Directly invoking BDA processing Lambda for file: ${filePath}`);
  
  if (!BDA_DATA_PROCESSING_LAMBDA_ARN) {
    throw new Error('BDA_DATA_PROCESSING_LAMBDA_ARN environment variable is not set');
  }
  
  // Create a payload that mimics an API Gateway event
  const detailPayload = {
    input_filename: filePath,
    output_filename: `${jobId}/output.json`,
    blueprints: [
      {
        blueprint_arn: blueprintArn,
      }
    ],
    data_automation_profile_arn: dataAutomationProfileArn
  };
  
  // Structure the payload as an API Gateway event
  const payload = {
    httpMethod: 'POST',
    path: '/invoke',
    body: JSON.stringify(detailPayload),
    headers: {
      'Content-Type': 'application/json'
    },
    requestContext: {
      identity: {
        sourceIp: '127.0.0.1'
      },
      requestId: `${jobId}-${Date.now()}`
    },
    resource: '/invoke',
    isBase64Encoded: false
  };
  
  const params = {
    FunctionName: BDA_DATA_PROCESSING_LAMBDA_ARN,
    InvocationType: 'RequestResponse',
    Payload: JSON.stringify(payload)
  };
  
  try {
    const result = await lambda.invoke(params).promise();
    console.log('Lambda invoke result:', JSON.stringify(result, null, 2));
    
    if (result.FunctionError) {
      throw new Error(`Lambda function error: ${result.FunctionError}`);
    }
    
    const responsePayload = JSON.parse(result.Payload);
    console.log('Response payload:', JSON.stringify(responsePayload, null, 2));
    
    if (responsePayload.statusCode !== 200) {
      throw new Error(`BDA processing Lambda returned error: ${JSON.stringify(responsePayload)}`);
    }
    
    const body = typeof responsePayload.body === 'string' 
      ? JSON.parse(responsePayload.body) 
      : responsePayload.body;
    
    // Parse the nested response structure
    console.log('Parsed body:', JSON.stringify(body, null, 2));
    
    // The response is deeply nested
    if (!body.response || !body.response.body || !body.response.body.response || !body.response.body.response.invocationArn) {
      throw new Error('BDA processing Lambda response does not contain invocationArn');
    }
    
    return body.response.body.response.invocationArn;
  } catch (error) {
    console.error('Error invoking BDA processing Lambda:', error);
    throw new Error(`Failed to invoke BDA processing Lambda: ${error.message}.`);
  }
}

/**
 * Directly invoke the BDA Results Lambda function
 */
async function invokeBDAResultsLambda(invocationArn, wait = false) {
  console.log(`Directly invoking BDA results Lambda for invocation: ${invocationArn}`);
  
  if (!BDA_RESULTS_LAMBDA_ARN) {
    throw new Error('BDA_RESULTS_LAMBDA_ARN environment variable is not set');
  }
  
  // Create a payload that mimics an API Gateway event
  const detailPayload = {
    invocation_arn: invocationArn,
    wait: wait
  };
  
  // Structure the payload as an API Gateway event
  const payload = {
    httpMethod: 'POST',
    path: '/status',
    body: JSON.stringify(detailPayload),
    headers: {
      'Content-Type': 'application/json'
    },
    requestContext: {
      identity: {
        sourceIp: '127.0.0.1'
      },
      requestId: `status-${Date.now()}`
    },
    resource: '/status',
    isBase64Encoded: false
  };
  
  const params = {
    FunctionName: BDA_RESULTS_LAMBDA_ARN,
    InvocationType: 'RequestResponse',
    Payload: JSON.stringify(payload)
  };
  
  try {
    const result = await lambda.invoke(params).promise();
    console.log('Lambda results invoke result:', JSON.stringify(result, null, 2));
    
    if (result.FunctionError) {
      throw new Error(`Lambda function error: ${result.FunctionError}`);
    }
    
    const responsePayload = JSON.parse(result.Payload);
    console.log('Results response payload:', JSON.stringify(responsePayload, null, 2));
    
    if (responsePayload.statusCode !== 200) {
      throw new Error(`BDA results Lambda returned error: ${JSON.stringify(responsePayload)}`);
    }
    
    const body = typeof responsePayload.body === 'string' 
      ? JSON.parse(responsePayload.body) 
      : responsePayload.body;
    
    return body;
  } catch (error) {
    console.error('Error invoking BDA results Lambda:', error);
    throw new Error(`Failed to invoke BDA results Lambda: ${error.message}`);
  }
}

/**
 * Wait for a BDA job to complete by directly calling the Results Lambda
 */
async function waitForBDAJobCompletion(invocationArn, jobId) {
  console.log(`Waiting for BDA job to complete: ${invocationArn}`);
  
  const maxAttempts = 30;
  const delayMs = 4000;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Directly invoke the BDA Results Lambda
      const result = await invokeBDAResultsLambda(invocationArn, false);
      console.log(`BDA job status check result:`, JSON.stringify(result, null, 2));
      
      // Check if the job is completed
      if (result.status === 'Success' && result.results && result.results.length > 0) {
        console.log(`BDA job completed successfully`);
        return result.results[0]; // Return the first result
      } else if (result.status === 'FAILED' || result.status === 'CANCELLED') {
        throw new Error(`BDA job failed with status: ${result.status}`);
      }
      
      console.log(`Job still in progress with status: ${result.status}, waiting...`);
      
      // Wait before checking again
      await new Promise(resolve => setTimeout(resolve, delayMs));
    } catch (error) {
      console.error(`Error checking BDA job status: ${error.message}`);
      // Continue trying rather than failing immediately
    }
  }
  
  throw new Error(`BDA job did not complete within the expected time`);
}

/**
 * Store the structured data in S3
 */
async function storeStructuredData(jobId, filePath, fileType, data) {
  console.log(`Storing structured data for job ${jobId}, file ${filePath}`);
  
  // Create a clean filename from the filePath
  const fileName = filePath.split('/').pop();
  const cleanFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  
  // Create a structured path for the raw extracted data
  const rawDataPath = `processed/${jobId}/${fileType}/${cleanFileName}.json`;
  
  // Add metadata to the structured data
  const enhancedData = {
    metadata: {
      jobId,
      originalFile: filePath,
      fileType,
      processingTimestamp: new Date().toISOString(),
      structuredDataPath: rawDataPath
    },
    extractedData: data
  };
  
  // Store the raw extracted data
  const rawParams = {
    Bucket: STRUCTURED_DATA_BUCKET,
    Key: rawDataPath,
    Body: JSON.stringify(enhancedData, null, 2),
    ContentType: 'application/json'
  };
  
  await s3.putObject(rawParams).promise();
  console.log(`Raw structured data stored at s3://${STRUCTURED_DATA_BUCKET}/${rawDataPath}`);
  
  // Format the data for the product website
  try {
    // Get job details to check if this is a new product or an update
    const jobDetails = await getJobDetails(jobId);
    const isNew = jobDetails?.isNew !== false; // Default to true if not specified
    const productId = jobDetails.productId;
    
    // Extract document and image data from the raw data
    const documentData = fileType.toLowerCase().includes('pdf') ? data : null;
    const imageData = fileType.toLowerCase().includes('image') ? data : null;
    
    // If this is an image file, copy it to the structured data bucket and add it to the product's images array
    let imageMetadata = null;
    if (fileType.toLowerCase().includes('image')) {
      const imageId = generateImageId();
      const filename = filePath.split('/').pop();
      const contentType = detectContentType(filePath);
      
      // Copy the image from the raw upload bucket to the structured data bucket
      const productImagePath = `products/${productId}/images/${imageId}-${filename}`;
      
      try {
        // Get the image from the raw upload bucket
        const imageData = await s3.getObject({
          Bucket: RAW_FILES_BUCKET,
          Key: filePath
        }).promise();
        
        // Store the image in the structured data bucket
        await s3.putObject({
          Bucket: STRUCTURED_DATA_BUCKET,
          Key: productImagePath,
          Body: imageData.Body,
          ContentType: contentType
        }).promise();
        
        console.log(`Copied image from s3://${RAW_FILES_BUCKET}/${filePath} to s3://${STRUCTURED_DATA_BUCKET}/${productImagePath}`);
        
        // Create image metadata with the new path
        imageMetadata = {
          id: imageId,
          filename: filename,
          path: productImagePath,
          contentType: contentType,
          description: imageData?.visual_description || 'Product image',
          uploadedAt: new Date().toISOString()
        };
      } catch (error) {
        console.error(`Error copying image: ${error.message}`);
      }
    }
    
    
    // Store the raw extracted data for the merge process to use
    
    // We'll only store the raw data and let the merge process handle formatting
    // The merge process will use the raw data from the processed directory
    const productDataPath = `processed/${jobId}/${fileType}/${cleanFileName}.json`;
    
    // Update job status with the product ID for tracking
    console.log(`Raw data stored at s3://${STRUCTURED_DATA_BUCKET}/${rawDataPath}`);
    
    // Get the current job details to retrieve the processedFiles array
    const updatedJobDetails = await getJobDetails(jobId);
    const processedFiles = updatedJobDetails?.processedFiles || [];
    
    // Add this file to the processedFiles array
    processedFiles.push({
      fileName: filePath.split('/').pop(),
      fileType,
      filePath,
      processingId: `${jobId}-${Date.now()}`,
      structuredDataPath: productDataPath
    });
    
    // If this is an image file, add it to the product's images array in DynamoDB
    if (imageMetadata) {
      // Get the current product data from S3 or create a new one
      const productData = await getProductData(productId) || {};
      
      // Initialize the images array if it doesn't exist
      if (!productData.images) {
        productData.images = [];
      }
      
      // Add the new image to the images array
      productData.images.push(imageMetadata);
      
      // Store the updated product data
      await storeProductData(productId, productData);
      
      console.log(`Added image metadata to product ${productId}: ${JSON.stringify(imageMetadata)}`);
    }
    
    // Create a processed file entry for this file
    const processedFileEntry = {
      fileName: filePath.split('/').pop(),
      fileType,
      filePath,
      processingId: `${jobId}-${Date.now()}`,
      structuredDataPath: productDataPath
    };
    
    // Update the job tracking table with the product ID and append to the processedFiles array
    // Use atomic update operations to prevent race conditions
    await appendProcessedFile(jobId, processedFileEntry, {
      productId,
      productDataPath,
      imageMetadata // Include image metadata if this is an image file
    });
    
    // Check if all files for this job have been processed and trigger merge if needed
    await checkAndTriggerMerge(jobId, productId, isNew);
    
    return {
      rawDataPath,
      productDataPath,
      productId
    };
  } catch (error) {
    console.error('Error formatting product data:', error);
    // Return the raw data path even if formatting fails
    return rawDataPath;
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
 * Check if all files for a job have been processed and trigger the merge process
 * Uses DynamoDB conditional update to prevent race conditions
 */
async function checkAndTriggerMerge(jobId, productId, isNew) {
  console.log(`Checking if all files for job ${jobId} have been processed`);
  
  try {
    // Get the job details from DynamoDB
    const jobDetails = await getJobDetails(jobId);
    if (!jobDetails) {
      console.warn(`Job ${jobId} not found, cannot check for merge`);
      return;
    }
    
    // Check if all files have been processed
    const totalFiles = jobDetails.totalFiles || 0;
    const processedFiles = jobDetails.processedFiles || [];
    const createdAt = jobDetails.createdAt;
    
    console.log(`Checking merge status: ${processedFiles.length} of ${totalFiles} files processed`);
    
    if (processedFiles.length === totalFiles) {
      console.log(`All ${totalFiles} files for job ${jobId} have been processed, attempting to trigger merge`);
      
      // Use a conditional update to ensure the merge is only triggered once
      // This prevents race conditions when multiple files finish processing at the same time
      try {
        // Update job status to "MergeTriggered" only if the current status is not already "MergeTriggered" or "Merging"
        const params = {
          TableName: JOB_TRACKING_TABLE,
          Key: {
            jobId: jobId,
            createdAt: createdAt
          },
          UpdateExpression: 'SET #status = :newStatus, mergeTriggeredAt = :timestamp',
          ConditionExpression: 'attribute_not_exists(#status) OR (#status <> :mergeTriggered AND #status <> :merging)',
          ExpressionAttributeNames: {
            '#status': 'status'
          },
          ExpressionAttributeValues: {
            ':newStatus': 'MergeTriggered',
            ':timestamp': new Date().toISOString(),
            ':mergeTriggered': 'MergeTriggered',
            ':merging': 'Merging'
          },
          ReturnValues: 'UPDATED_NEW'
        };
        
        const result = await dynamoDB.update(params).promise();
        console.log('Conditional update result:', JSON.stringify(result, null, 2));
        
        // If we got here, the update was successful and we can trigger the merge process
        console.log('Successfully updated job status to MergeTriggered, triggering merge process');
        await triggerMergeProcess(jobId, productId, isNew);
      } catch (conditionError) {
        // If the condition failed, it means another process has already triggered the merge
        if (conditionError.code === 'ConditionalCheckFailedException') {
          console.log('Merge process has already been triggered by another process, skipping');
        } else {
          // For other errors, log and continue
          console.error('Error updating job status with condition:', conditionError);
        }
      }
    } else {
      console.log(`Not all files processed yet: ${processedFiles.length} of ${totalFiles}`);
    }
  } catch (error) {
    console.error(`Error checking and triggering merge: ${error.message}`);
    // Don't throw the error, as this is a non-critical operation
  }
}

/**
 * Get product data from S3
 * @param {String} productId - Product ID
 * @returns {Object} - Product data
 */
async function getProductData(productId) {
  try {
    const params = {
      Bucket: STRUCTURED_DATA_BUCKET,
      Key: `products/${productId}/${productId}.json`
    };
    
    const response = await s3.getObject(params).promise();
    return JSON.parse(response.Body.toString('utf-8'));
  } catch (error) {
    console.log(`Product data not found for ${productId}: ${error.message}`);
    return null;
  }
}

/**
 * Store product data in S3
 * @param {String} productId - Product ID
 * @param {Object} productData - Product data
 */
async function storeProductData(productId, productData) {
  try {
    // Ensure the product data has a timestamp
    if (!productData.updatedAt) {
      productData.updatedAt = new Date().toISOString();
    }
    
    const params = {
      Bucket: STRUCTURED_DATA_BUCKET,
      Key: `products/${productId}/${productId}.json`,
      Body: JSON.stringify(productData, null, 2),
      ContentType: 'application/json'
    };
    
    await s3.putObject(params).promise();
    console.log(`Product data stored at s3://${STRUCTURED_DATA_BUCKET}/products/${productId}/${productId}.json`);
    
    return true;
  } catch (error) {
    console.error(`Error storing product data: ${error.message}`);
    throw error;
  }
}

/**
 * Append a processed file to the job's processedFiles array using atomic update operations
 * This prevents race conditions when multiple files are processed simultaneously
 */
async function appendProcessedFile(jobId, processedFileEntry, additionalData = {}) {
  if (!JOB_TRACKING_TABLE) {
    console.warn('JOB_TRACKING_TABLE environment variable not set, skipping processedFile update');
    return;
  }
  
  console.log(`Appending processed file to job ${jobId}:`, JSON.stringify(processedFileEntry, null, 2));
  
  try {
    // Get the createdAt timestamp for the job (needed as the sort key)
    const createdAt = await getJobCreatedAt(jobId);
    
    // Use the DynamoDB update expression with list_append to atomically append to the processedFiles array
    let updateExpression = 'SET updatedAt = :updatedAt, #status = :status';
    const expressionAttributeNames = {
      '#status': 'status',
      '#processedFiles': 'processedFiles'
    };
    const expressionAttributeValues = {
      ':updatedAt': new Date().toISOString(),
      ':status': 'ProductFormatted',
      ':emptyList': []
    };
    
    // Add the processedFiles array with list_append
    // If processedFiles doesn't exist, create it with the new item
    // If it does exist, append the new item to it
    updateExpression += ', #processedFiles = list_append(if_not_exists(#processedFiles, :emptyList), :newFile)';
    expressionAttributeValues[':newFile'] = [processedFileEntry];
    
    // Add additional data to the update expression
    let counter = 0;
    for (const [key, value] of Object.entries(additionalData)) {
      if (key !== 'processedFiles') { // Skip processedFiles as we're handling it specially
        const attributeName = `#attr${counter}`;
        const attributeValue = `:val${counter}`;
        
        updateExpression += `, ${attributeName} = ${attributeValue}`;
        expressionAttributeNames[attributeName] = key;
        expressionAttributeValues[attributeValue] = value;
        
        counter++;
      }
    }
    
    const params = {
      TableName: JOB_TRACKING_TABLE,
      Key: {
        jobId: jobId,
        createdAt: createdAt
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'UPDATED_NEW'
    };
    
    const result = await dynamoDB.update(params).promise();
    console.log(`Processed file appended to job:`, JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error(`Error appending processed file: ${error.message}`);
    // Don't throw the error, as this is a non-critical operation
    return null;
  }
}

/**
 * Trigger the merge process by publishing an event to EventBridge
 */
async function triggerMergeProcess(jobId, productId, isNew) {
  console.log(`Triggering merge process for job ${jobId}, product ${productId}`);
  
  const eventParams = {
    Entries: [
      {
        Source: 'custom.product-description-generator',
        DetailType: 'Merge Product Data Request',
        Detail: JSON.stringify({
          jobId,
          productId,
          isNew,
          timestamp: new Date().toISOString()
        }),
        EventBusName: EVENT_BUS_NAME
      }
    ]
  };
  
  try {
    const result = await eventBridge.putEvents(eventParams).promise();
    console.log('EventBridge putEvents result:', JSON.stringify(result, null, 2));
    
    if (result.FailedEntryCount > 0) {
      throw new Error(`Failed to publish merge event: ${JSON.stringify(result.Entries)}`);
    }
    
    return true;
  } catch (error) {
    console.error(`Error triggering merge process: ${error.message}`);
    
    // Update job status to indicate merge trigger failure
    await updateJobStatus(jobId, 'MergeTriggerFailed', {
      error: error.message,
      errorTime: new Date().toISOString()
    });
    
    throw error;
  }
}

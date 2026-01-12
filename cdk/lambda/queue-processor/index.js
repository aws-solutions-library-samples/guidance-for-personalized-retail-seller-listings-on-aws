/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda();

// Environment variables
const RAW_FILES_BUCKET = process.env.RAW_FILES_BUCKET;
const STRUCTURED_DATA_BUCKET = process.env.STRUCTURED_DATA_BUCKET;
const JOB_TRACKING_TABLE = process.env.JOB_TRACKING_TABLE;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'default';
const EXTRACT_PRODUCT_INFO_FUNCTION_ARN = process.env.EXTRACT_PRODUCT_INFO_FUNCTION_ARN;

/**
 * Lambda function to process messages from the SQS queue
 */
exports.handler = async (event) => {
  console.log('Processing SQS event:', JSON.stringify(event, null, 2));
  console.log(`Number of records in event: ${event.Records.length}`);
  
  try {
    // Process each record in the SQS event
    for (const record of event.Records) {
      console.log(`Processing record with messageId: ${record.messageId}`);
      const message = JSON.parse(record.body);
      console.log('Processing message:', JSON.stringify(message, null, 2));
      
      // Extract job information
      const { jobId, files, createdAt } = message;
      
      // Update job status to "Processing"
      await updateJobStatus(jobId, 'Processing', { createdAt });
      
      // Process each file in the job
      for (const file of files) {
        const { fileName, fileType, fileKey } = file;
        
        // Get the file path in S3
        const filePath = fileKey || `${jobId}/${fileName}`;
        
        // Process the file based on its type
        await processFile(jobId, filePath, fileType);
      }
      
      // Update job status to "Processing"
      // The extract-product-info Lambda will update the status to "Processed" when it's done
      // and will trigger the merge process if all files have been processed
      await updateJobStatus(jobId, 'Processing', { 
        totalFiles: files.length,
        message: 'Files are being processed asynchronously'
      });
    }
    
    return {
      statusCode: 200,
      body: 'Successfully processed all records'
    };
  } catch (error) {
    console.error('Error processing SQS event:', error);
    
    // If we have a jobId, update its status to "Error"
    if (event.Records && event.Records.length > 0) {
      try {
        const message = JSON.parse(event.Records[0].body);
        const { jobId } = message;
        await updateJobStatus(jobId, 'Error', { error: error.message });
      } catch (updateError) {
        console.error('Error updating job status:', updateError);
      }
    }
    
    throw error;
  }
};

/**
 * Update the job status in DynamoDB
 */
async function updateJobStatus(jobId, status, additionalData = {}) {
  console.log(`Updating job ${jobId} status to ${status}`);
  
  // Check if createdAt is provided in additionalData
  let createdAt = additionalData.createdAt;
  
  // If not, get it from DynamoDB
  if (!createdAt) {
    createdAt = await getJobCreatedAt(jobId);
    if (!createdAt) {
      console.error(`Could not find job with ID ${jobId}`);
      return;
    }
  }
  
  // Remove createdAt from additionalData to avoid duplicate in update expression
  if (additionalData.createdAt) {
    delete additionalData.createdAt;
  }
  
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
      createdAt: createdAt
    },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: 'UPDATED_NEW'
  };
  
  await dynamoDB.update(params).promise();
}

/**
 * Get the createdAt timestamp for a job (needed as the sort key for DynamoDB)
 */
async function getJobCreatedAt(jobId) {
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
    
    // If job not found, return null
    return null;
  } catch (error) {
    console.error(`Error getting job createdAt: ${error.message}`);
    return null;
  }
}

/**
 * Process a file using the extract-product-info Lambda via EventBridge
 */
async function processFile(jobId, filePath, fileType) {
  console.log(`Processing file ${filePath} of type ${fileType}`);
  
  // Create a unique ID for this processing request
  const processingId = `${jobId}-${Date.now()}`;
  
  // Publish an event to EventBridge to trigger the extract-product-info Lambda
  // Ensure the event structure matches the input transformer in EventRulesStack
  const eventParams = {
    Entries: [
      {
        Source: 'custom.product-description-generator',
        DetailType: 'Process File Request',
        Detail: JSON.stringify({
          jobId,
          fileType,
          filePath,
          processingId
        }),
        EventBusName: EVENT_BUS_NAME
      }
    ]
  };
  
  try {
    // Publish the event
    const eventResult = await eventBridge.putEvents(eventParams).promise();
    console.log('EventBridge putEvents result:', JSON.stringify(eventResult, null, 2));
    
    if (eventResult.FailedEntryCount > 0) {
      throw new Error(`Failed to publish event: ${JSON.stringify(eventResult.Entries)}`);
    }
    
    // We're now using EventBridge with input transformers for reliable event processing
    // Direct Lambda invocation has been removed to prevent duplicate processing
    console.log('Using EventBridge for extract-product-info Lambda invocation');
    
    // Return a placeholder for the structured data
    // The actual data will be stored by the extract-product-info Lambda
    return {
      jobId,
      fileType,
      filePath,
      processingId,
      status: 'Processing',
      message: 'File processing has been initiated'
    };
  } catch (error) {
    console.error('Error triggering file processing:', error);
    
    // Publish an error event
    await publishErrorEvent(jobId, filePath, fileType, error.message);
    
    throw new Error(`Failed to process file ${filePath}: ${error.message}`);
  }
}

/**
 * Publish an error event to EventBridge
 */
async function publishErrorEvent(jobId, filePath, fileType, errorMessage) {
  const eventParams = {
    Entries: [
      {
        Source: 'custom.product-description-generator',
        DetailType: 'Process File Error',
        Detail: JSON.stringify({
          jobId,
          fileType,
          filePath,
          error: errorMessage
        }),
        EventBusName: EVENT_BUS_NAME
      }
    ]
  };
  
  try {
    await eventBridge.putEvents(eventParams).promise();
  } catch (error) {
    console.error('Error publishing error event:', error);
  }
}

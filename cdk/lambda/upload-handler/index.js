/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const { v4: uuidv4 } = require('uuid');

/**
 * Generates a unique product ID in the format 'product-id-<hex>'
 * @returns {String} - Unique product ID with alphanumeric hex ID
 */
function generateProductId() {
  // Generate a random 8-character hexadecimal string
  const hexId = Math.floor(Math.random() * 0xFFFFFFFF).toString(16).padStart(8, '0');
  
  // Return product ID in the format 'product-id-<hex>'
  return `product-id-${hexId}`;
}

// Environment variables
const RAW_FILES_BUCKET = process.env.RAW_FILES_BUCKET;
const JOB_TRACKING_TABLE = process.env.JOB_TRACKING_TABLE;
const PROCESSING_QUEUE_URL = process.env.PROCESSING_QUEUE_URL;

/**
 * Main handler function for API Gateway events
 */
exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  try {
    // Route based on HTTP method
    switch (event.httpMethod) {
      case 'POST':
        return await handlePostRequest(event);
      case 'GET':
        return await handleGetRequest(event);
      default:
        return createResponse({
          statusCode: 405,
          body: JSON.stringify({ message: 'Method not allowed' }),
          origin: event.headers.origin
        })
    }
  } catch (error) {
    console.error('Error:', error);
    return createResponse({
      statusCode: 500,
      body: JSON.stringify({ message: 'Internal server error', error: error.message }),
      origin: event.headers.origin
    })
  }
};

/**
 * Handle POST request to create a new upload job
 */
async function handlePostRequest(event) {
  // Parse request body
  const body = JSON.parse(event.body);
  
  // Extract user ID from the Authorization header or use a default for testing
  // Use a shorter user ID to avoid S3 key length issues
  let userId = 'default-user';
  if (event.headers?.Authorization) {
    // Extract just the first 8 characters of the token as the user ID
    // This is just for path construction and not for authentication
    const token = event.headers.Authorization.split(' ')[1];
    userId = token ? token.substring(0, 8) : 'default-user';
  }
  
  // Validate request
  if (!body.files || !Array.isArray(body.files) || body.files.length === 0) {
    return createResponse({
      statusCode: 400,
      body: JSON.stringify({ message: 'Missing required field: files (array)' }),
      origin: event.headers.origin
    });
  }
  
  // Validate file types - only allow .pdf, .png, .jpg, and .jpeg
  const allowedExtensions = ['pdf', 'png', 'jpg', 'jpeg'];
  const invalidFiles = body.files.filter(fileName => {
    const extension = fileName.split('.').pop().toLowerCase();
    return !allowedExtensions.includes(extension);
  });
  
  if (invalidFiles.length > 0) {
    return createResponse({
      statusCode: 400,
      body: JSON.stringify({ 
        message: 'Invalid file types. Only PDF, PNG, and JPG files are allowed.',
        invalidFiles
      }),
      origin: event.headers.origin
    });
  }
  
  // For existing products (isNew is false), productId is required
  if (body.isNew === false && !body.productId) {
    return createResponse({
      statusCode: 400,
      body: JSON.stringify({ message: 'Product ID is required for existing products' }),
      origin: event.headers.origin
    });
  }
  
  // Generate unique job ID
  const jobId = uuidv4();
  const timestamp = new Date().toISOString();
  
  // For new products without a productId, generate a proper product ID
  // For existing products, use the provided productId
  const productId = body.productId || generateProductId();
  
  // Generate pre-signed URLs for each file
  const uploadUrls = {};
  const fileKeys = {};
  
  for (const fileName of body.files) {
    // Extract file extension to determine content type
    const fileExtension = fileName.split('.').pop().toLowerCase();
    let contentType = 'application/octet-stream'; // Default content type
    
    // Map common extensions to content types
    const contentTypeMap = {
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'txt': 'text/plain',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'md': 'text/markdown',
    };
    
    if (contentTypeMap[fileExtension]) {
      contentType = contentTypeMap[fileExtension];
    }
    
    const key = `uploads/${userId}/${productId}/${jobId}/${fileName}`;
    fileKeys[fileName] = key;
    
    uploadUrls[fileName] = await s3.getSignedUrlPromise('putObject', {
      Bucket: RAW_FILES_BUCKET,
      Key: key,
      ContentType: contentType,
      Expires: 300, // URL expires in 5 minutes
    });
  }
  
  // Create job record in DynamoDB
  const jobItem = {
    jobId,
    createdAt: timestamp,
    userId: userId,
    productId: productId,
    files: body.files,
    fileKeys: fileKeys,
    status: 'PENDING',
    isNew: body.isNew !== false, // Default to true if not specified
    updatedAt: timestamp,
  };
  
  await dynamoDB.put({
    TableName: JOB_TRACKING_TABLE,
    Item: jobItem,
  }).promise();
  
  // Send a message to the processing queue
  await sendToProcessingQueue(jobId);
  
  // Return response with pre-signed URLs and job ID
  return createResponse({
    statusCode: 201,
    body: JSON.stringify({
      jobId,
      productId: productId,
      uploadUrls,
      status: 'PENDING',
      message: 'Upload job created successfully',
    }),
    origin: event.headers.origin
  });
}

/**
 * Handle GET request to check job status
 */
async function handleGetRequest(event) {
  // Get job ID from path parameters
  const jobId = event.pathParameters?.jobId;
  
  if (!jobId) {
    return createResponse({
      statusCode: 400,
      body: JSON.stringify({ message: 'Missing job ID' }),
      origin: event.headers.origin
    })
  }
  
  // Get job record from DynamoDB
  // Use query instead of get since we need to query by partition key only
  const result = await dynamoDB.query({
    TableName: JOB_TRACKING_TABLE,
    KeyConditionExpression: 'jobId = :jobId',
    ExpressionAttributeValues: {
      ':jobId': jobId,
    },
    Limit: 1, // We only need the most recent record
  }).promise();
  
  if (!result.Items || result.Items.length === 0) {
    return createResponse({
      statusCode: 404,
      body: JSON.stringify({ message: 'Job not found' }),
      origin: event.headers.origin
    })
  }
  
  // Return job status
  return createResponse({
    statusCode: 200,
    body: JSON.stringify(result.Items[0]),
    origin: event.headers.origin
  })
}

/**
 * Send message to SQS queue for processing
 */
async function sendToProcessingQueue(jobId) {
  // Get the job details from DynamoDB
  const result = await dynamoDB.query({
    TableName: JOB_TRACKING_TABLE,
    KeyConditionExpression: 'jobId = :jobId',
    ExpressionAttributeValues: {
      ':jobId': jobId,
    },
    Limit: 1,
  }).promise();
  
  if (!result.Items || result.Items.length === 0) {
    throw new Error(`Job not found: ${jobId}`);
  }
  
  const job = result.Items[0];
  
  // Extract file names and types from the job
  const fileNames = job.files || [];
  const fileKeys = job.fileKeys || {};
  
  // Create an array of file objects with fileName and fileType
  const files = fileNames.map(fileName => {
    // Extract file extension to determine content type
    const fileExtension = fileName.split('.').pop().toLowerCase();
    let fileType = 'application/octet-stream'; // Default content type
    
    // Map common extensions to content types
    const contentTypeMap = {
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'txt': 'text/plain',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'md': 'text/markdown',
    };
    
    if (contentTypeMap[fileExtension]) {
      fileType = contentTypeMap[fileExtension];
    }
    
    return {
      fileName,
      fileType,
      fileKey: fileKeys[fileName] || `uploads/${job.userId}/${job.productId}/${jobId}/${fileName}`
    };
  });
  
  // Send message to SQS queue
  await sqs.sendMessage({
    QueueUrl: PROCESSING_QUEUE_URL,
    MessageBody: JSON.stringify({
      jobId,
      productId: job.productId,
      userId: job.userId,
      files,
      isNew: job.isNew !== false, // Default to true if not specified
      createdAt: job.createdAt
    }),
    MessageAttributes: {
      JobType: {
        DataType: 'String',
        StringValue: 'PROCESS_UPLOAD',
      },
    },
  }).promise();
}

const createResponse = (input) => {
	return {
		headers: {
			"Access-Control-Allow-Origin": input.origin ?? "*",
			"Content-Type": input.contentType ?? "application/json",
			'Access-Control-Allow-Headers': '*',
			'Access-Control-Allow-Methods': '*',
		},
		statusCode: input.statusCode,
		body: input.body
	};
}

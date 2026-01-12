/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import { NagSuppressions } from 'cdk-nag';
import * as path from 'path';

export interface LambdaFunctionsStackProps extends cdk.StackProps {
  rawFilesBucket: s3.IBucket;
  structuredDataBucket: s3.IBucket;
  jobTrackingTable: dynamodb.ITable;
  processingQueue: sqs.IQueue;
  eventBusName?: string;
}

export class LambdaFunctionsStack extends cdk.Stack {
  public readonly queueProcessorFunction: lambda.Function;
  public readonly productDataFunction: lambda.Function;
  public readonly uploadHandlerFunction: lambda.Function;
  public readonly mergeProductDataFunction: lambda.Function;
  public readonly productImageFunction: lambda.Function;
  
  constructor(scope: Construct, id: string, props: LambdaFunctionsStackProps) {
    super(scope, id, props);

    // Create CloudWatch log group for Lambda function
    const processorLogGroup = new logs.LogGroup(this, 'ProcessorLogGroup', {
      logGroupName: '/aws/lambda/product-description-generator-processor',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create Lambda function for processing queue messages
    const queueProcessorFunction = new NodejsFunction(this, 'QueueProcessorFunction', {
      functionName: 'ProductDescriptionGeneratorQueueProcessor',
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../lambda/queue-processor/index.js'),
      timeout: cdk.Duration.minutes(15), // Maximum Lambda timeout
      memorySize: 1024, // Increased memory for processing
      logGroup: processorLogGroup, // Associate the log group with the lambda function
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        RAW_FILES_BUCKET: props.rawFilesBucket.bucketName,
        STRUCTURED_DATA_BUCKET: props.structuredDataBucket.bucketName,
        JOB_TRACKING_TABLE: props.jobTrackingTable.tableName,
      },
    });
    this.queueProcessorFunction = queueProcessorFunction;

    // Add SQS event source to Lambda function
    this.queueProcessorFunction.addEventSource(new lambdaEventSources.SqsEventSource(props.processingQueue, {
      batchSize: 1, // Process one message at a time
      maxBatchingWindow: cdk.Duration.seconds(0), // No batching window
    }));

    // Grant permissions to the Lambda function
    props.rawFilesBucket.grantRead(this.queueProcessorFunction);
    props.structuredDataBucket.grantWrite(this.queueProcessorFunction);
    props.jobTrackingTable.grantReadWriteData(this.queueProcessorFunction);
    
    // If eventBusName is provided, add environment variables and permissions
    if (props.eventBusName) {
      // Update the queue processor function environment with the event bus name
      this.queueProcessorFunction.addEnvironment('EVENT_BUS_NAME', props.eventBusName);
      
      // Grant permissions to the queue processor function to put events to EventBridge
      const eventBusArn = `arn:aws:events:${this.region}:${this.account}:event-bus/${props.eventBusName}`;
      
      this.queueProcessorFunction.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['events:PutEvents'],
          resources: [eventBusArn]
        })
      );
    }

    // Grant Bedrock permissions to the Lambda functions
    const bedrockPolicy = new iam.PolicyStatement({
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeAgent',
        'bedrock:Retrieve',
        'bedrock:InvokeModelWithResponseStream',
        'bedrock:GetInferenceProfile',
        'bedrock:ListInferenceProfiles',
      ],
      resources: ['*'], // Will be restricted to specific models in production
    });

    this.queueProcessorFunction.addToRolePolicy(bedrockPolicy);
    
    // Create CloudWatch log group for Merge Product Data Lambda function
    const mergeProductDataLogGroup = new logs.LogGroup(this, 'MergeProductDataLogGroup', {
      logGroupName: '/aws/lambda/product-description-generator-merge-product-data',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    
    // Create Lambda function for merging product data from multiple documents
    const mergeProductDataFunction = new NodejsFunction(this, 'MergeProductDataFunction', {
      functionName: 'ProductDescriptionGeneratorMergeProductData',
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../lambda/merge-product-data/index.js'),
      timeout: cdk.Duration.minutes(15), // Maximum Lambda timeout
      memorySize: 1024, // Increased memory for processing
      logGroup: mergeProductDataLogGroup,
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        STRUCTURED_DATA_BUCKET: props.structuredDataBucket.bucketName,
        JOB_TRACKING_TABLE: props.jobTrackingTable.tableName,
        BEDROCK_MODEL_ID: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0', // Updated model ID
      },
    });
    this.mergeProductDataFunction = mergeProductDataFunction;
    
    // Grant permissions to the merge product data function
    props.structuredDataBucket.grantReadWrite(this.mergeProductDataFunction);
    props.jobTrackingTable.grantReadWriteData(this.mergeProductDataFunction);
    this.mergeProductDataFunction.addToRolePolicy(bedrockPolicy);

    // Create Lambda function for serving product data
    const productDataFunction = new NodejsFunction(this, 'ProductDataFunction', {
      functionName: 'ProductDescriptionGeneratorProductData',
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../lambda/product-data/index.js'),
      timeout: cdk.Duration.seconds(30),
      tracing: lambda.Tracing.ACTIVE,
      memorySize: 256,
      environment: {
        STRUCTURED_DATA_BUCKET: props.structuredDataBucket.bucketName,
      },
    });
    this.productDataFunction = productDataFunction;

    // Grant permissions to the Lambda function to read and delete from the structured data bucket
    props.structuredDataBucket.grantReadWrite(this.productDataFunction);
    
    // Create CloudWatch log group for Product Image Lambda function
    const productImageLogGroup = new logs.LogGroup(this, 'ProductImageLogGroup', {
      logGroupName: '/aws/lambda/product-description-generator-product-image',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    
    // Create Lambda function for serving product images
    const productImageFunction = new NodejsFunction(this, 'ProductImageFunction', {
      functionName: 'ProductDescriptionGeneratorProductImage',
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../lambda/product-image/index.js'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512, // Higher memory for image processing
      logGroup: productImageLogGroup,
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        RAW_FILES_BUCKET: props.rawFilesBucket.bucketName,
        STRUCTURED_DATA_BUCKET: props.structuredDataBucket.bucketName,
        JOB_TRACKING_TABLE: props.jobTrackingTable.tableName,
      },
    });
    this.productImageFunction = productImageFunction;
    
    // Grant permissions to the product image function
    props.rawFilesBucket.grantRead(this.productImageFunction);
    props.structuredDataBucket.grantRead(this.productImageFunction);
    props.jobTrackingTable.grantReadData(this.productImageFunction);

    // Create Lambda function for upload handling
    const uploadHandlerFunction = new NodejsFunction(this, 'UploadHandlerFunction', {
      functionName: 'ProductDescriptionGeneratorUploadHandler',
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../lambda/upload-handler/index.js'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        RAW_FILES_BUCKET: props.rawFilesBucket.bucketName,
        JOB_TRACKING_TABLE: props.jobTrackingTable.tableName,
        PROCESSING_QUEUE_URL: props.processingQueue.queueUrl,
      },
    });
    this.uploadHandlerFunction = uploadHandlerFunction;

    // Grant permissions to the upload handler function
    props.rawFilesBucket.grantReadWrite(this.uploadHandlerFunction);
    props.jobTrackingTable.grantReadWriteData(this.uploadHandlerFunction);
    props.processingQueue.grantSendMessages(this.uploadHandlerFunction);

    // Apply CDK Nag suppressions
    this.applyCdkNagSuppressions();

    // Output the Lambda function ARNs
    new cdk.CfnOutput(this, 'QueueProcessorFunctionArn', {
      value: this.queueProcessorFunction.functionArn,
      description: 'ARN of the queue processor Lambda function',
    });

    new cdk.CfnOutput(this, 'ProductDataFunctionArn', {
      value: this.productDataFunction.functionArn,
      description: 'ARN of the product data Lambda function',
    });

    new cdk.CfnOutput(this, 'UploadHandlerFunctionArn', {
      value: this.uploadHandlerFunction.functionArn,
      description: 'ARN of the upload handler Lambda function',
    });
    
    new cdk.CfnOutput(this, 'MergeProductDataFunctionArn', {
      value: this.mergeProductDataFunction.functionArn,
      description: 'ARN of the merge product data Lambda function',
    });
    
    new cdk.CfnOutput(this, 'ProductImageFunctionArn', {
      value: this.productImageFunction.functionArn,
      description: 'ARN of the product image Lambda function',
    });
  }

  private applyCdkNagSuppressions() {
    // Suppress CDK Nag warnings for specific cases
    NagSuppressions.addResourceSuppressions(
      this.queueProcessorFunction,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'Bedrock permissions will be restricted to specific models in production',
        },
      ],
      true
    );

    // Suppress IAM4 for Lambda execution roles
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/QueueProcessorFunction/ServiceRole/Resource`,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'This is the standard AWS managed policy for Lambda basic execution, which is required for CloudWatch logs',
          appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
        },
      ]
    );

    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/ProductDataFunction/ServiceRole/Resource`,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'This is the standard AWS managed policy for Lambda basic execution, which is required for CloudWatch logs',
          appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
        },
      ]
    );

    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/UploadHandlerFunction/ServiceRole/Resource`,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'This is the standard AWS managed policy for Lambda basic execution, which is required for CloudWatch logs',
          appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
        },
      ]
    );
    
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/MergeProductDataFunction/ServiceRole/Resource`,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'This is the standard AWS managed policy for Lambda basic execution, which is required for CloudWatch logs',
          appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
        },
      ]
    );
    
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/ProductImageFunction/ServiceRole/Resource`,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'This is the standard AWS managed policy for Lambda basic execution, which is required for CloudWatch logs',
          appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
        },
      ]
    );

    // Suppress IAM5 for action wildcards
    NagSuppressions.addResourceSuppressions(
      this.productDataFunction,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'These S3 permissions are required for the Lambda function to read and delete from the structured data bucket',
          appliesTo: [
            'Action::s3:GetBucket*',
            'Action::s3:GetObject*',
            'Action::s3:List*',
            'Action::s3:DeleteObject*',
            'Action::s3:PutObject*',
            'Resource::*/*',
          ],
        },
      ],
      true
    );

    NagSuppressions.addResourceSuppressions(
      this.uploadHandlerFunction,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'These S3 permissions are required for the Lambda function to handle file uploads and processing',
          appliesTo: [
            'Action::s3:Abort*',
            'Action::s3:DeleteObject*',
            'Action::s3:GetBucket*',
            'Action::s3:GetObject*',
            'Action::s3:List*',
            'Resource::*/*',
          ],
        },
      ],
      true
    );
    
    NagSuppressions.addResourceSuppressions(
      this.mergeProductDataFunction,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'These S3 permissions are required for the Lambda function to read and write product data',
          appliesTo: [
            'Action::s3:Abort*',
            'Action::s3:DeleteObject*',
            'Action::s3:GetBucket*',
            'Action::s3:GetObject*',
            'Action::s3:List*',
            'Action::s3:PutObject*',
            'Resource::*/*',
          ],
        },
      ],
      true
    );
    
    NagSuppressions.addResourceSuppressions(
      this.productImageFunction,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'These S3 permissions are required for the Lambda function to read images from S3 buckets',
          appliesTo: [
            'Action::s3:GetBucket*',
            'Action::s3:GetObject*',
            'Action::s3:List*',
            'Resource::*/*',
          ],
        },
      ],
      true
    );

    // Global suppressions for the entire stack
    NagSuppressions.addStackSuppressions(
      this,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'Resource wildcards are required to access all objects in the buckets and DynamoDB indexes',
        },
      ],
      true
    );
  }
}

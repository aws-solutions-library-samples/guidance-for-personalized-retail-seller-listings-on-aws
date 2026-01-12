#!/usr/bin/env node
/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { StorageStack } from '../lib/storage-stack';
import { ProductWebsiteStack } from '../lib/product-website-stack';
import { AuthStack } from '../lib/auth-stack';
import { EventBusStack } from '../lib/event-bus-stack';
import { LambdaFunctionsStack } from '../lib/lambda-functions-stack';
import { BedrockResourcesStack } from '../lib/bedrock-resources-stack';
import { EventRulesStack } from '../lib/event-rules-stack';
import { ApiStack } from '../lib/api-stack';
import { QueueStack } from '../lib/queue-stack';
import { Aspects } from 'aws-cdk-lib';
import * as config from './config/infra.config.json';
import { AwsSolutionsChecks } from 'cdk-nag';

const app = new cdk.App();

// Define the environment for all stacks
const env = { 
  account: process.env.CDK_DEFAULT_ACCOUNT, 
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1' 
};

// Create the main stack
const storageStack = new StorageStack(app, `${config.stackPrefix}-StorageStack`, {
  env,
  // Add tags to all resources
  tags: {
    Project: `${config.stackPrefix}`,
    Environment: 'Dev',
  },
});

// Create the authentication stack first
const authStack = new AuthStack(app, `${config.stackPrefix}-AuthStack`, {
  env,
  tags: {
    Project: `${config.stackPrefix}`,
    Environment: 'Dev',
  },
});

// Create the queue stack
const queueStack = new QueueStack(app, `${config.stackPrefix}-QueueStack`, {
  env,
  tags: {
    Project: `${config.stackPrefix}`,
    Environment: 'Dev',
  },
});

// Create the event bus stack first to avoid circular dependencies
const eventBusStack = new EventBusStack(app, `${config.stackPrefix}-EventBusStack`, {
  env,
  tags: {
    Project: `${config.stackPrefix}`,
    Environment: 'Dev',
  },
});

// Create the Lambda functions stack
const lambdaStack = new LambdaFunctionsStack(app, `${config.stackPrefix}-LambdaFunctionsStack`, {
  env,
  rawFilesBucket: storageStack.rawFilesBucket,
  structuredDataBucket: storageStack.structuredDataBucket,
  jobTrackingTable: storageStack.jobTrackingTable,
  processingQueue: queueStack.processingQueue,
  eventBusName: eventBusStack.bdaEventBus.eventBusName,
  tags: {
    Project: `${config.stackPrefix}`,
    Environment: 'Dev',
    Component: 'Lambda',
  },
});

// Create the API stack
const apiStack = new ApiStack(app, `${config.stackPrefix}-ApiStack`, {
  env,
  rawFilesBucket: storageStack.rawFilesBucket,
  structuredDataBucket: storageStack.structuredDataBucket,
  jobTrackingTable: storageStack.jobTrackingTable,
  accessLogsBucket: storageStack.accessLogsBucket,
  processingQueue: queueStack.processingQueue,
  productDataFunction: lambdaStack.productDataFunction,
  uploadHandlerFunction: lambdaStack.uploadHandlerFunction,
  productImageFunction: lambdaStack.productImageFunction,
  userPool: authStack.userPool,
  tags: {
    Project: `${config.stackPrefix}`,
    Environment: 'Dev',
  },
});

// Create the Bedrock resources stack
const bedrockStack = new BedrockResourcesStack(app, `${config.stackPrefix}-BedrockResourcesStack`, {
  env,
  rawFilesBucket: storageStack.rawFilesBucket,
  structuredDataBucket: storageStack.structuredDataBucket,
  jobTrackingTable: storageStack.jobTrackingTable,
  eventBus: eventBusStack.bdaEventBus,
  tags: {
    Project: `${config.stackPrefix}`,
    Environment: 'Dev',
    Component: 'Bedrock',
  },
});

// Create the event rules stack
const eventRulesStack = new EventRulesStack(app, `${config.stackPrefix}-EventRulesStack`, {
  env,
  eventBus: eventBusStack.bdaEventBus,
  extractProductInfoFunction: bedrockStack.extractProductInfoFunction,
  mergeProductDataFunction: lambdaStack.mergeProductDataFunction,
  bedrockDataAutomation: bedrockStack.bedrockDataAutomation,
  tags: {
    Project: `${config.stackPrefix}`,
    Environment: 'Dev',
    Component: 'EventRules',
  },
});

// Create the product website stack with the user pool (now without API Gateway)
const websiteStack = new ProductWebsiteStack(app, `${config.stackPrefix}-ProductWebsiteStack`, {
  env,
  structuredDataBucket: storageStack.structuredDataBucket,
  userPool: authStack.userPool,
  api: apiStack.api,
  tags: {
    Project: `${config.stackPrefix}`,
    Environment: 'Dev',
  },
});

// Add dependencies to ensure stacks are created in the correct order
lambdaStack.addDependency(queueStack);
lambdaStack.addDependency(eventBusStack);
apiStack.addDependency(authStack);
apiStack.addDependency(storageStack);
apiStack.addDependency(queueStack);
apiStack.addDependency(lambdaStack);
bedrockStack.addDependency(lambdaStack);
eventRulesStack.addDependency(lambdaStack);
eventRulesStack.addDependency(bedrockStack);
eventRulesStack.addDependency(eventBusStack);
websiteStack.addDependency(authStack);
websiteStack.addDependency(apiStack);

// Apply CDK Nag to ensure security best practices
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

app.synth();

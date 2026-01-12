/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import { NagSuppressions } from 'cdk-nag';
import { BedrockDataAutomation } from '@cdklabs/generative-ai-cdk-constructs';

export interface EventRulesStackProps extends cdk.StackProps {
  eventBus: events.IEventBus;
  extractProductInfoFunction: lambda.IFunction;
  mergeProductDataFunction: lambda.IFunction;
  bedrockDataAutomation: BedrockDataAutomation;
}

export class EventRulesStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EventRulesStackProps) {
    super(scope, id, props);

    // Create dead-letter queue for EventBridge rules
    const eventBridgeDLQ = new sqs.Queue(this, 'EventBridgeDLQ', {
      queueName: 'ProductDescriptionGeneratorEventBridgeDLQ',
      retentionPeriod: cdk.Duration.days(14),
      enforceSSL: true
    });
    
    // Create rule for processing file requests
    const processFileRule = new events.Rule(this, 'ProcessFileRule', {
      eventBus: props.eventBus,
      eventPattern: {
        source: ['custom.product-description-generator'],
        detailType: ['Process File Request']
      },
      description: 'Rule for processing file requests'
    });
    
    // Create rule for merging product data
    const mergeProductDataRule = new events.Rule(this, 'MergeProductDataRule', {
      eventBus: props.eventBus,
      eventPattern: {
        source: ['custom.product-description-generator'],
        detailType: ['Merge Product Data Request']
      },
      description: 'Rule for merging product data from multiple documents'
    });
    
    // Use CloudFormation escape hatches to break the circular dependency
    // Instead of using CDK's high-level constructs, we'll directly manipulate the CloudFormation resources
    
    // Get the underlying CloudFormation resources for process file rule
    const cfnProcessFileRule = processFileRule.node.defaultChild as events.CfnRule;
    const cfnExtractLambda = props.extractProductInfoFunction.node.defaultChild as lambda.CfnFunction;
    
    // Create a unique ID for the permission
    const extractPermissionId = 'AllowProcessFileRuleInvocation' + Math.random().toString(36).substring(2, 8);
    
    // Create the Lambda permission directly as a CloudFormation resource
    // This bypasses CDK's dependency analysis
    const cfnExtractPermission = new lambda.CfnPermission(this, extractPermissionId, {
      action: 'lambda:InvokeFunction',
      functionName: props.extractProductInfoFunction.functionName,
      principal: 'events.amazonaws.com',
      sourceArn: processFileRule.ruleArn,
    });
    
    // Get the underlying CloudFormation resources for merge product data rule
    const cfnMergeRule = mergeProductDataRule.node.defaultChild as events.CfnRule;
    const cfnMergeLambda = props.mergeProductDataFunction.node.defaultChild as lambda.CfnFunction;
    
    // Create a unique ID for the permission
    const mergePermissionId = 'AllowMergeRuleInvocation' + Math.random().toString(36).substring(2, 8);
    
    // Create the Lambda permission directly as a CloudFormation resource
    const cfnMergePermission = new lambda.CfnPermission(this, mergePermissionId, {
      action: 'lambda:InvokeFunction',
      functionName: props.mergeProductDataFunction.functionName,
      principal: 'events.amazonaws.com',
      sourceArn: mergeProductDataRule.ruleArn,
    });
    
    // Manually define the target with input transformer for process file rule
    cfnProcessFileRule.addPropertyOverride('Targets', [{
      Id: 'ExtractProductInfoTarget',
      Arn: props.extractProductInfoFunction.functionArn,
      DeadLetterConfig: {
        Arn: eventBridgeDLQ.queueArn
      },
      RetryPolicy: {
        MaximumRetryAttempts: 3,
        MaximumEventAgeInSeconds: 3600
      },
      InputTransformer: {
        InputPathsMap: {
          "jobId": "$.detail.jobId",
          "fileType": "$.detail.fileType",
          "filePath": "$.detail.filePath"
        },
        InputTemplate: `{
          "jobId": <jobId>,
          "fileType": <fileType>,
          "filePath": <filePath>
        }`
      }
    }]);
    
    // Manually define the target with input transformer for merge product data rule
    cfnMergeRule.addPropertyOverride('Targets', [{
      Id: 'MergeProductDataTarget',
      Arn: props.mergeProductDataFunction.functionArn,
      DeadLetterConfig: {
        Arn: eventBridgeDLQ.queueArn
      },
      RetryPolicy: {
        MaximumRetryAttempts: 3,
        MaximumEventAgeInSeconds: 3600
      },
      InputTransformer: {
        InputPathsMap: {
          "jobId": "$.detail.jobId",
          "productId": "$.detail.productId",
          "isNew": "$.detail.isNew"
        },
        InputTemplate: `{
          "detail": {
            "jobId": <jobId>,
            "productId": <productId>,
            "isNew": <isNew>
          }
        }`
      }
    }]);
    
    // Add explicit dependency to ensure the Lambda functions are created before the permissions
    cfnExtractPermission.addDependency(cfnExtractLambda);
    cfnMergePermission.addDependency(cfnMergeLambda);
    
    // Suppress SQS3 warning for EventBridgeDLQ
    NagSuppressions.addResourceSuppressions(
      eventBridgeDLQ,
      [
        {
          id: 'AwsSolutions-SQS3',
          reason: 'This queue is used as a DLQ.'
        }
      ]
    );
  }
}

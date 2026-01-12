/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as logs from 'aws-cdk-lib/aws-logs';
import { BedrockDataAutomation } from '@cdklabs/generative-ai-cdk-constructs';
import { aws_bedrock as bedrock } from 'aws-cdk-lib';
import { NagSuppressions } from 'cdk-nag';
import * as path from 'path';
import { EventbridgeToLambda } from '@aws-solutions-constructs/aws-eventbridge-lambda';
import * as documentBlueprintSchema from '../bda-events/blueprints/document/document-blueprint-schema.json';
import * as imageBlueprintSchema from '../bda-events/blueprints/image/image-blueprint-schema.json';

export interface BedrockResourcesStackProps extends cdk.StackProps {
  rawFilesBucket: s3.IBucket;
  structuredDataBucket: s3.IBucket;
  jobTrackingTable: dynamodb.ITable;
  eventBus: events.IEventBus;
}

export class BedrockResourcesStack extends cdk.Stack {
  // public readonly bedrockAgent: bedrock.Agent;
  public readonly bedrockDataAutomation: BedrockDataAutomation;
  // public readonly agentAlias: bedrock.AgentAlias;
  public readonly extractProductInfoFunction: lambda.Function;
  
  constructor(scope: Construct, id: string, props: BedrockResourcesStackProps) {
    super(scope, id, props);

    const documentBlueprint = new bedrock.CfnBlueprint(this, 'DocumentBlueprint', {
      blueprintName: 'document_blueprint',
      schema: documentBlueprintSchema,
      type: 'DOCUMENT'
    });

    const imageBlueprint = new bedrock.CfnBlueprint(this, 'ImageBlueprint', {
      blueprintName: 'image_blueprint',
      schema: imageBlueprintSchema,
      type: 'IMAGE'
    });

    // Create Bedrock Data Automation construct
    this.bedrockDataAutomation = new BedrockDataAutomation(this, 'BedrockDataAutomation', {
      inputBucket: props.rawFilesBucket,
      outputBucket: props.rawFilesBucket, // Changed to rawFilesBucket to store BDA outputs in the raw bucket
      isCustomBDABlueprintRequired: true,
      isBDAProjectRequired: false,
      isBDAInvocationRequired: true,
      isStatusRequired: true
    });

    // Blueprint creation event
    new EventbridgeToLambda(this, 'BlueprintCreationEvent', {
      existingLambdaObj: this.bedrockDataAutomation.bdaBlueprintLambdaFunction,
      existingEventBusInterface: props.eventBus,
      eventRuleProps: {
        eventPattern: {
          source: ['custom.bedrock.blueprint.creation'],
          detailType: ['Bedrock Blueprint Creation'],
        }
      },
    });

    // Invocation event
    new EventbridgeToLambda(this, 'InvocationEvent', {
      existingLambdaObj: this.bedrockDataAutomation.bdaInvocationFunction,
      existingEventBusInterface: props.eventBus,
      eventRuleProps: {
        eventPattern: {
          source: ['custom.bedrock.invocation'],
          detailType: ['Bedrock Invoke Request'],
        }
      },
    });

    // Job status event
    new EventbridgeToLambda(this, 'ResultStatus', {
      existingLambdaObj: this.bedrockDataAutomation.bdaResultStatusFunction,
      existingEventBusInterface: props.eventBus,
      eventRuleProps:{
        eventPattern: {
          source: ['custom.bedrock.blueprint'],
          detailType: ['Bedrock Result Status']
        }
      }
    });

    // Create CloudWatch log group for the extract product info function
    const extractProductInfoLogGroup = new logs.LogGroup(this, 'ExtractProductInfoLogGroup', {
      logGroupName: '/aws/lambda/product-description-generator-extract-info',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create Lambda function for the action group
    this.extractProductInfoFunction = new NodejsFunction(this, 'ExtractProductInfoFunction', {
      functionName: 'ProductDescriptionGeneratorExtractInfo',
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../lambda/extract-product-info/index.js'),
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
      tracing: lambda.Tracing.ACTIVE,
      logGroup: extractProductInfoLogGroup,
      environment: {
        RAW_FILES_BUCKET: props.rawFilesBucket.bucketName,
        STRUCTURED_DATA_BUCKET: props.structuredDataBucket.bucketName,
        BDA_OUTPUT_BUCKET: props.rawFilesBucket.bucketName, // Add this line to specify where BDA outputs are stored
        JOB_TRACKING_TABLE: props.jobTrackingTable.tableName,
        BDA_DOCUMENT_BLUEPRINT_ARN: documentBlueprint.attrBlueprintArn,
        BDA_IMAGE_BLUEPRINT_ARN: imageBlueprint.attrBlueprintArn,
        BDA_DATA_PROCESSING_LAMBDA_ARN: this.bedrockDataAutomation.bdaInvocationFunction!.functionArn,
        BDA_RESULTS_LAMBDA_ARN: this.bedrockDataAutomation.bdaResultStatusFunction!.functionArn
      },
    });
    
    // Grant permissions to the action group Lambda function
    props.rawFilesBucket.grantReadWrite(this.extractProductInfoFunction);
    props.structuredDataBucket.grantReadWrite(this.extractProductInfoFunction);
    props.jobTrackingTable.grantReadWriteData(this.extractProductInfoFunction);
    
    // Update the extract product info function environment with the event bus name
    this.extractProductInfoFunction.addEnvironment('EVENT_BUS_NAME', props.eventBus.eventBusName);
    
    // Grant permissions to put events to EventBridge
    const eventBusArn = `arn:aws:events:${this.region}:${this.account}:event-bus/${props.eventBus.eventBusName}`;
    
    this.extractProductInfoFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [eventBusArn]
      })
    );

    // Grant Bedrock permissions to the Lambda function
    const bedrockPolicy = new iam.PolicyStatement({
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeAgent',
        'bedrock:Retrieve',
      ],
      resources: ['*'], // Will be restricted to specific models in production
    });

    this.extractProductInfoFunction.addToRolePolicy(bedrockPolicy);
    
    // Grant permission to invoke the BDA Data Processing Lambda function
    this.extractProductInfoFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [this.bedrockDataAutomation.bdaInvocationFunction!.functionArn]
      })
    );

    // Grant permission to invoke the BDA Results Lambda function
    this.extractProductInfoFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [this.bedrockDataAutomation.bdaResultStatusFunction!.functionArn]
      })
    );

    // Add CDK Nag suppressions for the extractProductInfoFunction
    // Suppress IAM4 for Lambda execution role
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.node.id}/ExtractProductInfoFunction/ServiceRole/Resource`,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'This is the standard AWS managed policy for Lambda basic execution, which is required for CloudWatch logs',
          appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
        },
      ]
    );
    
    // Suppress IAM5 for S3 wildcard permissions
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.node.id}/ExtractProductInfoFunction/ServiceRole/DefaultPolicy/Resource`,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'These S3 permissions are required for the Lambda function to read from the raw files bucket',
          appliesTo: [
            'Action::s3:GetBucket*',
            'Action::s3:GetObject*',
            'Action::s3:List*',
            'Resource::<RawFilesBucket655532EE.Arn>/*',
          ],
        },
      ]
    );
    
    // Suppress IAM5 for S3 write permissions
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.node.id}/ExtractProductInfoFunction/ServiceRole/DefaultPolicy/Resource`,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'These S3 permissions are required for the Lambda function to write to the structured data bucket',
          appliesTo: [
            'Action::s3:Abort*',
            'Action::s3:DeleteObject*',
            'Resource::<StructuredDataBucket5558431F.Arn>/*',
          ],
        },
      ]
    );
    
    // Suppress IAM5 for DynamoDB wildcard permissions
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.node.id}/ExtractProductInfoFunction/ServiceRole/DefaultPolicy/Resource`,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'These DynamoDB permissions are required for the Lambda function to access the job tracking table',
          appliesTo: [
            'Resource::<JobTrackingTable72075FD4.Arn>/index/*',
          ],
        },
      ]
    );
    
    // Suppress IAM5 for Bedrock wildcard permissions
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.node.id}/ExtractProductInfoFunction/ServiceRole/DefaultPolicy/Resource`,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'Bedrock permissions will be restricted to specific models in production',
          appliesTo: [
            'Resource::*',
          ],
        },
      ]
    );
    
  }
}

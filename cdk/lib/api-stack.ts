/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { NagSuppressions } from 'cdk-nag';

export interface ApiStackProps extends cdk.StackProps {
  // Resources needed for the API
  structuredDataBucket: s3.IBucket;
  rawFilesBucket: s3.IBucket;
  jobTrackingTable: dynamodb.ITable;
  accessLogsBucket: s3.IBucket;
  processingQueue: sqs.Queue;
  productDataFunction: lambda.IFunction;
  uploadHandlerFunction: lambda.IFunction;
  productImageFunction?: lambda.IFunction; // New function for product images
  userPool?: cognito.IUserPool;
}

export class ApiStack extends cdk.Stack {
  // Expose API for other stacks to use
  public readonly api: apigateway.RestApi;
  
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // Create CloudWatch log group for API Gateway
    const apiLogGroup = new logs.LogGroup(this, 'ApiAccessLogs', {
      logGroupName: '/aws/apigateway/product-description-generator-api-access-logs',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create a single consolidated API Gateway with logging
    this.api = new apigateway.RestApi(this, 'ConsolidatedApi', {
      restApiName: 'Product Description Generator API',
      description: 'Consolidated API for the Product Description Generator',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS, // Will be restricted in production
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type', 
          'X-Amz-Date', 
          'Authorization', 
          'X-Api-Key',
          'X-Amz-Security-Token',
          ...apigateway.Cors.DEFAULT_HEADERS
        ],
        maxAge: cdk.Duration.days(1),
        statusCode: 200
      },
      deployOptions: {
        accessLogDestination: new apigateway.LogGroupLogDestination(apiLogGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        stageName: 'prod',
        tracingEnabled: true,
      },
      // Add binary media types for image support
      binaryMediaTypes: props.productImageFunction ? [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/svg+xml'
      ] : undefined,
    });
    
    // Create request validator for API Gateway
    const requestValidator = new apigateway.RequestValidator(this, 'RequestValidator', {
      restApi: this.api,
      validateRequestParameters: true,
      validateRequestBody: true,
    });

    // Create Cognito authorizer if user pool is provided
    let authorizer;
    if (props.userPool) {
      authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'ApiAuthorizer', {
        cognitoUserPools: [props.userPool],
        authorizerName: 'ApiCognitoAuthorizer',
        identitySource: 'method.request.header.Authorization',
      });
    }

    // ===== PRODUCTS RESOURCE =====
    
    // Create API Gateway resources and methods for Products
    const productsResource = this.api.root.addResource('products');
    
    // GET /products - List all products
    productsResource.addMethod('GET', new apigateway.LambdaIntegration(props.productDataFunction), {
      requestValidator: requestValidator,
      authorizationType: props.userPool ? apigateway.AuthorizationType.COGNITO : apigateway.AuthorizationType.NONE,
      authorizer: props.userPool ? authorizer : undefined,
    });
    
    // GET /products/{productId} - Get specific product data
    const productResource = productsResource.addResource('{productId}');
    productResource.addMethod('GET', new apigateway.LambdaIntegration(props.productDataFunction), {
      requestValidator: requestValidator,
      requestParameters: {
        'method.request.path.productId': true, // Make productId a required path parameter
      },
      authorizationType: props.userPool ? apigateway.AuthorizationType.COGNITO : apigateway.AuthorizationType.NONE,
      authorizer: props.userPool ? authorizer : undefined,
    });
    
    // DELETE /products/{productId} - Delete a product
    productResource.addMethod('DELETE', new apigateway.LambdaIntegration(props.productDataFunction), {
      requestValidator: requestValidator,
      requestParameters: {
        'method.request.path.productId': true, // Make productId a required path parameter
      },
      authorizationType: props.userPool ? apigateway.AuthorizationType.COGNITO : apigateway.AuthorizationType.NONE,
      authorizer: props.userPool ? authorizer : undefined,
    });
    
    // Add product images resource if the function is provided
    if (props.productImageFunction) {
      // GET /products/{productId}/images/{imageId} - Get product image
      const imagesResource = productResource.addResource('images');
      const imageResource = imagesResource.addResource('{imageId}');
      
      // Create Lambda integration for JSON response with presigned URL
      const imageIntegration = new apigateway.LambdaIntegration(props.productImageFunction);
      
      imageResource.addMethod('GET', imageIntegration, {
        requestValidator: requestValidator,
        requestParameters: {
          'method.request.path.productId': true,
          'method.request.path.imageId': true,
        },
        authorizationType: props.userPool ? apigateway.AuthorizationType.COGNITO : apigateway.AuthorizationType.NONE,
        authorizer: props.userPool ? authorizer : undefined,
      });
    }

    // ===== UPLOADS RESOURCE =====

    // Create API Gateway resources and methods for Uploads
    const uploadsResource = this.api.root.addResource('uploads');
    
    // POST /uploads - Create a new upload job
    uploadsResource.addMethod('POST', new apigateway.LambdaIntegration(props.uploadHandlerFunction), {
      requestValidator: requestValidator,
      authorizationType: props.userPool ? apigateway.AuthorizationType.COGNITO : apigateway.AuthorizationType.NONE,
      authorizer: props.userPool ? authorizer : undefined,
    });
    
    // GET /uploads/{jobId} - Get upload job status
    const jobResource = uploadsResource.addResource('{jobId}');
    jobResource.addMethod('GET', new apigateway.LambdaIntegration(props.uploadHandlerFunction), {
      requestValidator: requestValidator,
      requestParameters: {
        'method.request.path.jobId': true, // Make jobId a required path parameter
      },
      authorizationType: props.userPool ? apigateway.AuthorizationType.COGNITO : apigateway.AuthorizationType.NONE,
      authorizer: props.userPool ? authorizer : undefined,
    });

    // Suppress CDK Nag warnings for specific cases
    NagSuppressions.addResourceSuppressions(
      this.api,
      [
        {
          id: 'AwsSolutions-APIG4',
          reason: 'API Gateway authorization will be implemented in a later phase',
        },
        {
          id: 'AwsSolutions-COG4',
          reason: 'Cognito user pool will be implemented in a later phase',
        },
        {
          id: 'AwsSolutions-APIG3',
          reason: 'AWS WAF will be implemented in a later phase as this is a development environment',
        },
      ],
      true
    );

    // Suppress IAM4 for CloudWatch role - this is a standard AWS role for CloudWatch logs
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${id}/ConsolidatedApi/CloudWatchRole/Resource`,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'This is the standard AWS managed policy for API Gateway to push logs to CloudWatch',
          appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs'],
        },
      ]
    );


    // Output the API Gateway URL
    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: this.api.url,
      description: 'URL of the consolidated API Gateway',
    });

    
  }
}

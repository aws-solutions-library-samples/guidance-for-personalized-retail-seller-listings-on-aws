#!/bin/bash

# Guidance for Personalized Retail Seller Listings on AWS - One-Click Deploy Script
# This script automates the deployment process for AWS CodeBuild environment (Amazon Linux 2023)

set -e  # Exit on any error

echo "=========================================="
echo "Starting Deployment Process"
echo "=========================================="

# Get AWS account ID and region dynamically
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export AWS_REGION=${AWS_REGION:-us-east-1}
export TIMESTAMP=$(date +%Y%m%d%H%M%S)
export STACK_PREFIX="PDG-${TIMESTAMP}"

echo "AWS Account ID: ${AWS_ACCOUNT_ID}"
echo "AWS Region: ${AWS_REGION}"
echo "Stack Prefix: ${STACK_PREFIX}"
echo "Timestamp: ${TIMESTAMP}"

# Step 1: Install Node.js 18+ (if not already installed)
echo "=========================================="
echo "Step 1: Installing Node.js 18+"
echo "=========================================="
if ! command -v node &> /dev/null || [[ $(node -v | cut -d'v' -f2 | cut -d'.' -f1) -lt 18 ]]; then
    echo "Installing Node.js 18..."
    curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
    yum install -y nodejs
else
    echo "Node.js $(node -v) is already installed"
fi

# Step 2: Install AWS CDK globally
echo "=========================================="
echo "Step 2: Installing AWS CDK"
echo "=========================================="
npm install -g aws-cdk
echo "CDK version: $(cdk --version)"

# Step 3: Clone the repository (if not already in the directory)
echo "=========================================="
echo "Step 3: Setting up repository"
echo "=========================================="
if [ ! -d "guidance-for-personalized-retail-seller-listings-on-aws" ]; then
    echo "Cloning repository..."
    git clone https://github.com/aws-solutions-library-samples/guidance-for-personalized-retail-seller-listings-on-aws.git
    cd guidance-for-personalized-retail-seller-listings-on-aws
else
    echo "Repository already exists, using current directory"
    if [ ! -f "cdk/package.json" ]; then
        echo "Error: Not in the correct directory structure"
        exit 1
    fi
fi

# Step 4: Enable Bedrock model access
echo "=========================================="
echo "Step 4: Checking Bedrock Model Access"
echo "=========================================="
echo "Note: Bedrock model access must be enabled manually in the AWS Console"
echo "Required models: Amazon Titan, Anthropic Claude"
echo "Visit: https://console.aws.amazon.com/bedrock/home?region=${AWS_REGION}#/modelaccess"

# Step 5: Install CDK dependencies
echo "=========================================="
echo "Step 5: Installing CDK Dependencies"
echo "=========================================="
cd cdk
npm install
cd ..

# Step 6: Create CDK configuration file
echo "=========================================="
echo "Step 6: Creating CDK Configuration"
echo "=========================================="
cat > cdk/bin/config/infra.config.json <<EOF
{
    "stackPrefix": "${STACK_PREFIX}",
    "env": {
        "account": "${AWS_ACCOUNT_ID}",
        "region": "${AWS_REGION}"
    },
    "cdkNag": true
}
EOF
echo "Created infra.config.json with dynamic values"

# Step 7: Bootstrap CDK (if not already bootstrapped)
echo "=========================================="
echo "Step 7: Bootstrapping CDK"
echo "=========================================="
cd cdk
cdk bootstrap aws://${AWS_ACCOUNT_ID}/${AWS_REGION}

# Step 8: Deploy CDK stacks
echo "=========================================="
echo "Step 8: Deploying CDK Stacks"
echo "=========================================="
cdk deploy --all --require-approval never

# Step 9: Extract outputs from CDK deployment
echo "=========================================="
echo "Step 9: Extracting Deployment Outputs"
echo "=========================================="
export USER_POOL_ID=$(aws cloudformation describe-stacks \
    --stack-name ${STACK_PREFIX}-AuthStack \
    --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
    --output text)

export USER_POOL_CLIENT_ID=$(aws cloudformation describe-stacks \
    --stack-name ${STACK_PREFIX}-AuthStack \
    --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" \
    --output text)

export API_GATEWAY_URL=$(aws cloudformation describe-stacks \
    --stack-name ${STACK_PREFIX}-ApiStack \
    --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
    --output text)

export CLOUDFRONT_URL=$(aws cloudformation describe-stacks \
    --stack-name ${STACK_PREFIX}-ProductWebsiteStack \
    --query "Stacks[0].Outputs[?OutputKey=='WebsiteUrl'].OutputValue" \
    --output text)

echo "User Pool ID: ${USER_POOL_ID}"
echo "User Pool Client ID: ${USER_POOL_CLIENT_ID}"
echo "API Gateway URL: ${API_GATEWAY_URL}"
echo "CloudFront URL: ${CLOUDFRONT_URL}"

# Step 10: Create website configuration
echo "=========================================="
echo "Step 10: Creating Website Configuration"
echo "=========================================="
cd ../website
cat > src/config/runtime.config.json <<EOF
{
  "userPoolId": "${USER_POOL_ID}",
  "userPoolWebClientId": "${USER_POOL_CLIENT_ID}",
  "restApiEndpoint": "${API_GATEWAY_URL}"
}
EOF
echo "Created runtime.config.json with deployment outputs"

# Step 11: Create Cognito user
echo "=========================================="
echo "Step 11: Creating Cognito User"
echo "=========================================="
export ADMIN_EMAIL="admin-${TIMESTAMP}@example.com"
export ADMIN_PASSWORD="TempPass123!${TIMESTAMP}"

aws cognito-idp admin-create-user \
    --user-pool-id ${USER_POOL_ID} \
    --username admin \
    --user-attributes Name=email,Value=${ADMIN_EMAIL} Name=email_verified,Value=true \
    --temporary-password ${ADMIN_PASSWORD} \
    --region ${AWS_REGION}

aws cognito-idp admin-set-user-password \
    --user-pool-id ${USER_POOL_ID} \
    --username admin \
    --password ${ADMIN_PASSWORD} \
    --permanent \
    --region ${AWS_REGION}

echo "Created Cognito user: admin"
echo "Email: ${ADMIN_EMAIL}"
echo "Password: ${ADMIN_PASSWORD}"

# Step 12: Install website dependencies
echo "=========================================="
echo "Step 12: Installing Website Dependencies"
echo "=========================================="
npm install

# Step 13: Deploy website
echo "=========================================="
echo "Step 13: Deploying Website"
echo "=========================================="
npm run deploy

# Step 14: Validation
echo "=========================================="
echo "Step 14: Validating Deployment"
echo "=========================================="

# Check if CloudFront distribution is accessible
if curl -s -o /dev/null -w "%{http_code}" ${CLOUDFRONT_URL} | grep -q "200\|301\|302"; then
    echo "✓ CloudFront distribution is accessible"
else
    echo "✗ Warning: CloudFront distribution may not be accessible yet (DNS propagation may take time)"
fi

# Check if API Gateway is accessible
if curl -s -o /dev/null -w "%{http_code}" ${API_GATEWAY_URL}/products | grep -q "200\|401\|403"; then
    echo "✓ API Gateway is accessible"
else
    echo "✗ Warning: API Gateway may not be accessible"
fi

# Check if Cognito user pool exists
if aws cognito-idp describe-user-pool --user-pool-id ${USER_POOL_ID} --region ${AWS_REGION} &> /dev/null; then
    echo "✓ Cognito User Pool is configured"
else
    echo "✗ Error: Cognito User Pool not found"
fi

echo "=========================================="
echo "Deployment Complete!"
echo "=========================================="
echo ""
echo "Access your application at: ${CLOUDFRONT_URL}"
echo ""
echo "Login credentials:"
echo "  Username: admin"
echo "  Password: ${ADMIN_PASSWORD}"
echo ""
echo "Stack Prefix: ${STACK_PREFIX}"
echo "AWS Region: ${AWS_REGION}"
echo ""
echo "To clean up resources, run:"
echo "  cd cdk && cdk destroy --all"
echo "=========================================="

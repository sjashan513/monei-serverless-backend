import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as path from 'path';
import * as iam from 'aws-cdk-lib/aws-iam';

export class MoneiServerlessBackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. The DynamoDB Table
    const remindersTable = new dynamodb.Table(this, 'ReminderTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl', // Automatic record deletion
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 2. The API Lambda (The brain)
    const apiLambda = new NodejsFunction(this, 'ApiLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../src/api.ts'),
      handler: 'handler',
      environment: {
        TABLE_NAME: remindersTable.tableName,
      },
    });

    // 3. The Worker Lambda (The email sender)
    const workerLambda = new NodejsFunction(this, 'WorkerLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../src/worker.ts'),
      handler: 'handler',
      environment: {
        SENDER_EMAIL: process.env.SENDER_EMAIL || '',
        RECIPIENT_EMAIL: process.env.RECIPIENT_EMAIL || '',
      },
    });

    // 4. IAM Permissions for DynamoDB
    remindersTable.grantReadWriteData(apiLambda);

    // 5. IAM Permissions for SES (The fix for your AccessDenied error)
    const sesIdentityArn = `arn:aws:ses:${this.region}:${this.account}:identity/${process.env.SENDER_EMAIL}`;

    workerLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: [sesIdentityArn], // Target the specific verified email identity
    }));

    // General SES permissions for metrics/quotas
    workerLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:GetSendQuota', 'ses:GetSendStatistics'],
      resources: ['*'],
    }));

    // 6. API Gateway Configuration
    const api = new apigateway.RestApi(this, 'RemindersApi', {
      restApiName: 'Reminders Service',
      description: 'Service for scheduling and managing email reminders.',
    });

    const reminders = api.root.addResource('reminders');
    reminders.addMethod('POST', new apigateway.LambdaIntegration(apiLambda));
    reminders.addMethod('GET', new apigateway.LambdaIntegration(apiLambda));

    const singleReminder = reminders.addResource('{id}');
    singleReminder.addMethod('DELETE', new apigateway.LambdaIntegration(apiLambda));

    // 7. EventBridge Scheduler Role & Permissions
    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });

    // Allow Scheduler to trigger the Worker
    workerLambda.grantInvoke(schedulerRole);

    // Allow API to manage schedules
    apiLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['scheduler:CreateSchedule', 'scheduler:DeleteSchedule'],
      resources: ['*'],
    }));

    // Essential: Allow API to "Pass" the scheduler role to the EventBridge service
    apiLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      resources: [schedulerRole.roleArn],
    }));

    // Inject necessary ARNs for the API logic
    apiLambda.addEnvironment('WORKER_LAMBDA_ARN', workerLambda.functionArn);
    apiLambda.addEnvironment('SCHEDULER_ROLE_ARN', schedulerRole.roleArn);
  }
}
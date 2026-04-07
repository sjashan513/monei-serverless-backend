import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { ActionAfterCompletion, CreateScheduleCommand, DeleteScheduleCommand, FlexibleTimeWindowMode, SchedulerClient } from "@aws-sdk/client-scheduler";
import { DeleteCommand, DynamoDBDocument, PutCommand } from "@aws-sdk/lib-dynamodb";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { randomUUID } from "crypto";


const client = new DynamoDBClient({});
const dynamo = DynamoDBDocument.from(client);
const schedulerClient = new SchedulerClient({});
const WORKER_LAMBDA_ARN = process.env.WORKER_LAMBDA_ARN || '';
const SCHEDULER_ROLE_ARN = process.env.SCHEDULER_ROLE_ARN || '';
const TABLE_NAME = process.env.TABLE_NAME || '';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log('Received event:', JSON.stringify(event, null, 2));
    const routeKey = `${event.httpMethod} ${event.resource}`;

    try {
        switch (routeKey) {
            case 'POST /reminders':
                return await post_reminder(event);
            case 'GET /reminders':
                return await get_reminders(event);
            case 'DELETE /reminders/{id}':
                return await delete_reminder(event);
            default:
                return { statusCode: 404, body: JSON.stringify({ message: 'Route Not Found' }) };
        }
    } catch (error) {
        console.error('Error processing request:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Internal Server Error' }),
        };
    }

}


const post_reminder = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    if (!event.body) return { statusCode: 400, body: JSON.stringify({ message: 'Invalid request, missing body' }) };
    const body = JSON.parse(event.body);
    const { title, date } = body;

    if (!title || !date) {
        return { statusCode: 400, body: JSON.stringify({ message: 'Invalid request, missing title or date' }) };
    }

    const id = randomUUID();
    const targetDate = new Date(date);

    // We set the AUTO_CLEAN ttl
    // We set it to 1 hour after the reminder date, so we have some buffer to retrieve it after the reminder date has passed
    const ttl = Math.floor(targetDate.getTime() / 1000) + 3600;

    const reminderItem = {
        id,
        title,
        targetDate: targetDate.toISOString(),
        ttl,
        status: 'PENDING',
    };

    await dynamo.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: reminderItem,
    }));

    const formattedDate = targetDate.toISOString().replace(/\.\d{3}Z$/, '');
    await schedulerClient.send(new CreateScheduleCommand({
        Name: `reminder-${id}`,
        ScheduleExpression: `at(${formattedDate})`,
        ScheduleExpressionTimezone: 'UTC',
        FlexibleTimeWindow: { Mode: FlexibleTimeWindowMode.OFF },
        ActionAfterCompletion: ActionAfterCompletion.DELETE,
        Target: {
            Arn: WORKER_LAMBDA_ARN,
            RoleArn: SCHEDULER_ROLE_ARN,
            Input: JSON.stringify({ id, title }),
            RetryPolicy: {
                MaximumRetryAttempts: 3,
                MaximumEventAgeInSeconds: 3600,
            }
        },
    }))

    return {
        statusCode: 201,
        body: JSON.stringify({ message: 'Reminder created successfully', reminderId: id }),
    }
}

const get_reminders = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const response = await dynamo.send(new ScanCommand({
        TableName: TABLE_NAME,
    }));

    return {
        statusCode: 200,
        body: JSON.stringify(response.Items || []),
    };
}

const delete_reminder = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const reminderId = event.pathParameters?.id;
    if (!reminderId) return { statusCode: 400, body: JSON.stringify({ message: 'Invalid request, missing reminder id' }) };
    await dynamo.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { id: reminderId },
    }));

    try {
        await schedulerClient.send(new DeleteScheduleCommand({
            Name: `reminder-${reminderId}`,
        }));
    } catch (error: any) {
        // We don't fail the whole request if the schedule deletion fails, since the reminder is already deleted from DynamoDB
        console.error(`Error deleting schedule for reminder ${reminderId}:`, error);
    }

    return {
        statusCode: 200,
        body: JSON.stringify({ message: `Reminder ${reminderId} deleted successfully` }),
    }
}
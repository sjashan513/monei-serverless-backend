import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

// Initialize outside the handler for performance
const sesClient = new SESClient({});

export const handler = async (event: any): Promise<void> => {
    console.log('Worker woke up! Payload received:', JSON.stringify(event, null, 2));

    // The payload we passed from EventBridge in api.ts
    const { id, title } = event;

    // Read the configuration from Environment Variables (Requested by MONEI)
    const senderEmail = process.env.SENDER_EMAIL!;
    const recipientEmail = process.env.RECIPIENT_EMAIL!;

    try {
        const command = new SendEmailCommand({
            Source: senderEmail,
            Destination: {
                ToAddresses: [recipientEmail],
            },
            Message: {
                Subject: {
                    Data: `⏰ Reminder: ${title}`,
                    Charset: 'UTF-8',
                },
                Body: {
                    Text: {
                        Data: `Hello!\n\nThis is your scheduled reminder: ${title}\n\nReminder ID: ${id}`,
                        Charset: 'UTF-8',
                    },
                },
            },
        });

        await sesClient.send(command);
        console.log(`✅ Successfully sent email for reminder: ${id}`);


    } catch (error) {
        console.error(`❌ Failed to send email for reminder: ${id}`, error);
        // We throw the error to let EventBridge Scheduler know that the execution failed, so it can retry based on the retry policy we set in api.ts
        throw error;
    }
};
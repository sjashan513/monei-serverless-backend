# MONEI Serverless Backend Challenge 🚀

A high-performance, event-driven reminder service built with **TypeScript**, **AWS CDK**, and **Amazon EventBridge Scheduler**.

## 🧠 Development Philosophy: An "AI-Collaborative" Approach

I want to be transparent: **I have used AI (Gemini) as a Senior Architect during the development of this project.** Instead of simply asking for code, I used the AI as a debate partner to explore different cloud architectures. We analyzed various solutions (Polling, DynamoDB Streams, Step Functions, and EventBridge), weighed the trade-offs regarding cost and precision, and collectively decided on the architecture below.

**The Power of Iterative Learning:** The core benefit of this approach was the incredibly fast, iterative feedback loop. It gave me immediate, hands-on exposure to AWS technologies I hadn't used extensively before. By rapidly prototyping and discussing trade-offs, I was able to quickly grasp complex concepts like AWS CDK, IAM role passing, and distributed system resilience, ensuring the final solution wasn't just functional, but followed modern, highly-scalable industry best practices.

## 🛡️ Engineering Trade-offs & System Evaluation

Before writing any code, we evaluated several different methods to trigger the email sending. Here is the journey of how we arrived at the final design:

### 1. The Scheduling Engine Debate

We needed a way to trigger an email at a specific timestamp. We looked at four options:

- **CloudWatch Events (The "Cron Poller"):** A Lambda runs every 1 minute to check DynamoDB.
  - _Verdict:_ Rejected. It suffers from high "Idle" costs (1,440 executions a day even if zero reminders are due) and poor precision (O(N) scaling issues).

- **DynamoDB Streams + TTL:** Rely on DynamoDB deleting the item to trigger a Lambda.
  - _Verdict:_ Rejected. DynamoDB TTL deletions are not precise (AWS guarantees deletion within 48 hours, not immediately). Unacceptable for time-sensitive reminders.

- **AWS Step Functions (Wait State):** A state machine that waits until the target time.
  - _Verdict:_ Rejected. Highly precise, but architectural overkill and costly at scale due to state transition billing.

- **The Winner: Amazon EventBridge Scheduler:** $O(1)$ efficiency. We only invoke compute exactly when the email needs to be sent. It provides the precision of Step Functions but at a fraction of the cost, complete with built-in infrastructure retries.

### 2. Efficiency: `Scan` vs `Query`

I am transparently using a **`Scan`** for the `GET /reminders` endpoint.

- **The Reality:** For this specific candidate test scale, a `Scan` is simple and functional.
- **Better Approach:** I am fully aware that in a production environment with millions of rows, this must be replaced with a **Global Secondary Index (GSI)** and a **`Query`** operation to maintain performance and prevent massive cost spikes.

### 3. Fault Tolerance & The DLQ Trade-off

If SES fails (due to transient network issues), we don't handle retries inside the Lambda code. Instead, we rely on the **EventBridge Retry Policy**.

- **The DLQ Trade-off:** During our architectural debate, my AI Co-Pilot proposed attaching an Amazon SQS Dead Letter Queue (DLQ) to capture permanently failed events after all retries are exhausted. However, considering this is a candidate test rather than a full production environment, and to keep the IAM scope manageable given my current expertise, we intentionally skipped the DLQ implementation to prioritize delivering a clean, functional core architecture.

### 4. IAM & Security

Every permission in the CDK stack follows the **Principle of Least Privilege**. For example, the Worker Lambda only has permission to send emails from the specific verified SES Identity ARN, rather than granting blanket SES access.

## 🏗️ The Winning Architecture

Based on the trade-offs above, I implemented a **Push-Based, Event-Driven Architecture**:

1. **API Gateway**: Provides the public HTTP interface for the service.
2. **API Lambda**: The "Brain" that processes requests, manages DynamoDB records, and dynamically provisions one-time execution schedules.
3. **EventBridge Scheduler**: The "Precision Engine" that triggers exactly on time with zero polling.
4. **Worker Lambda**: The "Executor" that receives the event payload and sends emails via **Amazon SES**.
5. **Self-Cleaning Design**:
   - **DynamoDB TTL**: Records silently delete themselves 1 hour after firing.
   - **ActionAfterCompletion**: EventBridge schedules delete themselves immediately after successfully triggering the Worker Lambda.
     <img width="5269" height="2333" alt="image" src="https://github.com/user-attachments/assets/ad55134c-65bd-4560-b4e0-bef9c99cf76d" />

## 🚀 Getting Started

### Prerequisites

- AWS CLI configured with `us-east-1` (or your preferred region).
- Verified email identity in **Amazon SES** (Sandbox requires both Sender and Recipient verification).

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure .env
# Note: For SES Sandbox, you can use the same verified email for both
echo "SENDER_EMAIL=your.verified@email.com" >> .env
echo "RECIPIENT_EMAIL=your.verified@email.com" >> .env

# 3. Deploy to the cloud
npx cdk deploy
```

## 🧪 API Endpoints

POST /reminders: Schedule a new reminder.

GET /reminders: List current reminders.

DELETE /reminders/{id}: Cancel a reminder and instantly delete its pending schedule.

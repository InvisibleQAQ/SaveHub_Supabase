
# How to Setup Queue Jobs in NextJs with BullMQ

Learn How to integrate BullMQ with Next.js to create a background job queue for processing tasks in the background. We will setup the BullMQ queue, create a job, and process the job in the background.

In the world of web development, Next.js is a popular choice for building web applications. It is a React framework that provides a great developer experience with features like server-side rendering, static site generation, and more. Next.js has become a viable full-stack framework that can be used to build complex and scalable web applications. When building complex web applications, we may need to perform asynchronous tasks in background in a sequence of order and the best way to do this is by using queues. In this article, we will explore how to use [BullMQ](https://docs.bullmq.io/) with Next.js and Redis to create a background job queue for processing tasks in the background.

BullMQ is a Node.js library that provides a simple and reliable way to implement Redis-based queues in Node.js applications. It also provides advanced features such as job retries, job progress tracking, and concurrency control.

We will setup the BullMQ queue, create a job, and process the job in the background. **Let's get started!**

# Installing Bullmq

First, install BullMQ and Redis within your Next.js project.

```javascript
1npm install bullmq ioredis --save
```

next step is to create a queue worker, which will pull the tasks from queue and process them.

We will create all our worker files inside src/workers directory (if you are not using src directory, you can put it in the project root folder.).

Create workers/test.worker.ts file.

```javascript
1// src/workers/test.worker.ts
2import { Worker, Queue } from'bullmq';
3import Redis from'ioredis';
4const connection = new Redis(process.env.REDIS_URL!);
5exportconst testQueue = new Queue('testQueue', {
6    connection,
7defaultJobOptions: {
8attempts: 3,
9backoff: {
10type: 'exponential',
11delay: 3000,
12      },
13    },
14});
15const testWorker = new Worker(
16'testQueue', // this is the queue name, the first string parameter we provided for Queue()
17async (job) => {
18const data = job?.data;
19console.log(data);
20console.log('job executed successfully');
21  },
22  {
23    connection,
24concurrency: 5,
25removeOnComplete: { count: 1000 },
26removeOnFail: { count: 5000 },
27  }
28);
29exportdefault testWorker;
```

Now, we will add a script to our package.json file which will be use to process the queue. You also need to install dotenv and tsx package if not already installed.

```javascript
1npm install dotenv tsx --save
```

```javascript
1// package.json
2{
3  ...
4"scripts": {
5    ...
6"worker:test": "dotenv -e .env.local -- npx tsx --watch src/workers/test.worker.ts"
7  },
8  ...
9}
```

make sure you add the correct path in script based on your directory structure.

# Add jobs to the queue

Now we have created our test worker, we can add jobs to the queue. you can add the jobs to the queue from your server-side code (e.g., route handlers, API routes and server actions).

we will create an api route to add the job.

```javascript
1// src/api/add-test-job.ts  if you are using pages directory
2// src/app/add-test-job/route.ts  if you are using app directory
3
4import { NextResponse } from'next/server';
5import {testQueue} from'@/workers/test.worker';
6exportasyncfunctionGET(){
7const data = {
8message: 'This is a sample job'
9  }
10await testQueue.add('testJob', data,{ removeOnComplete: true });
11return NextResponse.json({'status': 'job added to the queue'});
12}
```

When you visit your route URL, it will add the job in queue.

# Running the worker

Now its time to process our test queue. To run the worker, do to your terminal and navigate to your project directory and run the below command :

npm run worker:test

It will process the pending queue and if hit your route again and add another job, it will process automatically.

Cool, Thats It! You have successfully integrated BullMQ with NextJs and Redis. You can now start building your own custom queue system with BullMQ. I hope you enjoyed this tutorial. Please share it with your friends and colleagues and don't forget to follow me on Twitter and Github.

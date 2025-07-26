const TelegramBot = require('node-telegram-bot-api');
const { MongoClient } = require('mongodb');
const axios = require('axios');
const fs = require('fs');
const path = require('path');


const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'YOUR_OPENAI_API_KEY';
const ADMIN_ID = 2053660453;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/speaking_bot';

// Initialize Telegram Bot
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Initialize MongoDB
let db;
async function connectDB() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db();
  console.log('Connected to MongoDB');
}
connectDB().catch(console.error);

// Task structure based on the document
const TASKS = {
  1: {
    title: "Task 1 - Basic Questions",
    parts: [
      {
        name: "Part 1: Questions 1-3",
        questions: [
          "Do you work or are you a student?",
          "What do you do on a typical day?",
          "Who was your first teacher?"
        ],
        prep_time: 5,  // seconds
        answer_time: 30,  // seconds per question
        rating_criteria: "questions_1_3"
      },
      {
        name: "Part 1.1: Questions 4-6",
        questions: [
          "Describe the picture you see.",
          "Question 5 (picture description)",
          "Question 6 (picture description)"
        ],
        prep_time: 5,
        answer_time: 30,
        rating_criteria: "questions_4_6"
      }
    ]
  },
  2: {
    title: "Task 2 - Mini Questions",
    parts: [
      {
        name: "Part 2: Question 7",
        questions: [
          "Can you describe a dream about success that you've had?",
          "How did this dream motivate you in real life?",
          "Do you think dreaming of success can lead to achieving it?"
        ],
        prep_time: 60,  // seconds
        answer_time: 120,  // seconds total
        rating_criteria: "question_7"
      }
    ]
  },
  3: {
    title: "Task 3 - Pros and Cons",
    parts: [
      {
        name: "Part 3: Question 8",
        topic: "Animals should have the same rights as humans",
        pros: [
          "Prevents cruelty and abuse",
          "Promotes ecological balance",
          "Recognizes animals as sentient beings"
        ],
        cons: [
          "Human needs take priority over animals",
          "Can be difficult to enforce",
          "Some industries could face challenges"
        ],
        prep_time: 60,  // seconds
        answer_time: 120,  // seconds
        rating_criteria: "question_8"
      }
    ]
  }
};

// User session data
const userSessions = {};

// Helper function to create keyboard markup
function createTaskKeyboard(userId, isAdmin = false) {
  const keyboard = [];
  
  // Add tasks 1-3 for everyone
  for (let i = 1; i <= 3; i++) {
    keyboard.push([{ text: `Task ${i}`, callback_data: `task_${i}` }]);
  }
  
  // Add admin panel button for admin
  if (isAdmin) {
    keyboard.push([{ text: "Admin Panel", callback_data: "admin_panel" }]);
  }
  
  return {
    reply_markup: {
      inline_keyboard: keyboard
    }
  };
}

// Start command handler
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userName = msg.from.first_name || msg.from.username || 'User';
  
  try {
    // Check if user exists in DB
    const users = db.collection('users');
    const user = await users.findOne({ user_id: userId });
    
    if (!user) {
      await users.insertOne({
        user_id: userId,
        name: userName,
        has_access: userId === ADMIN_ID,
        scores: {},
        created_at: new Date()
      });
    }
    
    // Send welcome message with web app button
    const welcomeText = `Salom, ${userName}!\n\nThis bot helps you practice and assess your speaking skills.`;
    
    await bot.sendMessage(chatId, welcomeText, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Open Web App", web_app: { url: "https://your-web-app-url.vercel.app" } }]
        ]
      }
    });
    
    // Show available tasks
    await showTasks(chatId, userId);
  } catch (error) {
    console.error('Error in /start:', error);
    await bot.sendMessage(chatId, "An error occurred. Please try again.");
  }
});

// Show tasks menu
async function showTasks(chatId, userId) {
  try {
    const users = db.collection('users');
    const user = await users.findOne({ user_id: userId });
    const isAdmin = userId === ADMIN_ID;
    
    await bot.sendMessage(chatId, "Select a task:", createTaskKeyboard(userId, isAdmin));
  } catch (error) {
    console.error('Error showing tasks:', error);
    await bot.sendMessage(chatId, "An error occurred. Please try again.");
  }
}

// Callback query handler
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;
  
  try {
    if (data.startsWith('task_')) {
      await handleTaskSelection(chatId, userId, data);
    } else if (data.startsWith('part_')) {
      await startTaskPart(chatId, userId, data);
    } else if (data === 'admin_panel') {
      await showAdminPanel(chatId, userId);
    } else if (data === 'back_to_tasks') {
      await showTasks(chatId, userId);
    } else if (data === 'grant_access') {
      await promptForUserId(chatId);
    }
    
    // Answer the callback query
    await bot.answerCallbackQuery(callbackQuery.id);
  } catch (error) {
    console.error('Error in callback query:', error);
    await bot.sendMessage(chatId, "An error occurred. Please try again.");
  }
});

// Handle task selection
async function handleTaskSelection(chatId, userId, callbackData) {
  const taskNum = parseInt(callbackData.split('_')[1]);
  const users = db.collection('users');
  const user = await users.findOne({ user_id: userId });
  
  // Check access (tasks 1-3 open for everyone)
  if (taskNum > 3 && !user.has_access && userId !== ADMIN_ID) {
    await bot.sendMessage(chatId, "You need admin approval to access this task.");
    return;
  }
  
  // Store current task in session
  userSessions[userId] = { current_task: taskNum, current_part: 0 };
  
  // Show task parts
  const task = TASKS[taskNum];
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        ...task.parts.map((part, index) => [{ text: part.name, callback_data: `part_${index}` }]),
        [{ text: "Back to Tasks", callback_data: "back_to_tasks" }]
      ]
    }
  };
  
  await bot.sendMessage(chatId, `${task.title}\nSelect a part:`, keyboard);
}

// Start a task part
async function startTaskPart(chatId, userId, callbackData) {
  const partNum = parseInt(callbackData.split('_')[1]);
  const session = userSessions[userId] || {};
  const taskNum = session.current_task || 1;
  
  const task = TASKS[taskNum];
  const part = task.parts[partNum];
  
  // Update session
  userSessions[userId] = {
    current_task: taskNum,
    current_part: partNum,
    current_question: 0,
    start_time: Date.now(),
    responses: []
  };
  
  // Show preparation message
  let prepText = `Preparation time: ${part.prep_time} seconds\n\n`;
  
  if (taskNum === 3) {  // Pros and cons task
    prepText += `Topic: ${part.topic}\n\nPros:\n`;
    prepText += part.pros.map(p => `- ${p}`).join('\n');
    prepText += "\n\nCons:\n";
    prepText += part.cons.map(c => `- ${c}`).join('\n');
  } else {
    if (part.questions.length > 1) {
      prepText += "Questions:\n";
      prepText += part.questions.map((q, i) => `${i+1}. ${q}`).join('\n');
    } else {
      prepText += `Question: ${part.questions[0]}`;
    }
  }
  
  await bot.sendMessage(chatId, prepText);
  
  // Wait for preparation time
  setTimeout(async () => {
    await askQuestion(chatId, userId);
  }, part.prep_time * 1000);
}

// Ask the current question
async function askQuestion(chatId, userId) {
  const session = userSessions[userId];
  if (!session) return;
  
  const taskNum = session.current_task || 1;
  const partNum = session.current_part || 0;
  const questionNum = session.current_question || 0;
  
  const task = TASKS[taskNum];
  const part = task.parts[partNum];
  
  if (questionNum < part.questions.length) {
    const question = part.questions[questionNum];
    const answerTime = part.answer_time / part.questions.length;
    
    await bot.sendMessage(
      chatId,
      `Question ${questionNum + 1}/${part.questions.length}:\n${question}\n\nYou have ${answerTime} seconds to answer.`
    );
    
    // Start timer for voice recording
    userSessions[userId].answer_start = Date.now();
    userSessions[userId].answer_duration = answerTime * 1000;
  } else {
    // All questions answered, evaluate
    await evaluateResponses(chatId, userId);
  }
}

// Handle voice messages
bot.on('voice', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  if (!userSessions[userId] || !userSessions[userId].answer_start) {
    return;
  }
  
  const session = userSessions[userId];
  
  // Calculate time left
  const timeUsed = Date.now() - session.answer_start;
  const timeLeft = session.answer_duration - timeUsed;
  
  if (timeLeft <= 0) {
    await bot.sendMessage(chatId, "Time's up! Moving to next question.");
    await askQuestion(chatId, userId);
    return;
  }
  
  try {
    // Download voice message
    const voiceFile = await bot.getFile(msg.voice.file_id);
    const voiceUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${voiceFile.file_path}`;
    
    // Transcribe with OpenAI Whisper
    const response = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      {
        file: voiceUrl,
        model: "whisper-1"
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'multipart/form-data'
        }
      }
    );
    
    const text = response.data.text || "[Transcription failed]";
    
    // Store response
    const taskNum = session.current_task;
    const partNum = session.current_part;
    const questionNum = session.current_question;
    
    session.responses.push({
      task: taskNum,
      part: partNum,
      question: questionNum,
      text: text,
      timestamp: new Date()
    });
    
    // Move to next question
    session.current_question += 1;
    await askQuestion(chatId, userId);
  } catch (error) {
    console.error('Error processing voice message:', error);
    await bot.sendMessage(chatId, "Error processing your response. Please try again.");
  }
});

// Evaluate responses
async function evaluateResponses(chatId, userId) {
  const session = userSessions[userId];
  
  if (!session || !session.responses || session.responses.length === 0) {
    await bot.sendMessage(chatId, "No responses to evaluate.");
    return;
  }
  
  const taskNum = session.current_task;
  const partNum = session.current_part;
  const part = TASKS[taskNum].parts[partNum];
  const criteria = part.rating_criteria;
  
  // Prepare evaluation prompt for OpenAI
  let prompt = `Evaluate the following speaking responses based on the CEFR criteria:
  
Task: ${TASKS[taskNum].title} - ${part.name}
Rating Criteria: ${criteria}

Responses:
`;
  
  session.responses.forEach((response, i) => {
    prompt += `\nQuestion ${i+1}: ${part.questions[i]}\nResponse: ${response.text}\n`;
  });
  
  prompt += `
Provide:
1. A CEFR level estimate (A1, A2, B1, B2, C1)
2. A score from 0-5 (or 0-6 for Question 8)
3. Detailed feedback on grammar, vocabulary, pronunciation, fluency, and cohesion
4. Suggestions for improvement
`;
  
  try {
    // Get evaluation from OpenAI
    const evaluation = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const feedback = evaluation.data.choices[0].message.content;
    
    // Save results to MongoDB
    const users = db.collection('users');
    const scoreKey = `tasks.${taskNum}.${partNum}`;
    
    await users.updateOne(
      { user_id: userId },
      { $set: {
        [scoreKey]: {
          score: 0,  // You'd extract this from the feedback
          feedback: feedback,
          date: new Date()
        }
      }}
    );
    
    // Send feedback to user
    await bot.sendMessage(chatId, `Evaluation Results:\n\n${feedback}`);
    
    // Show tasks again
    await showTasks(chatId, userId);
  } catch (error) {
    console.error('Error in evaluation:', error);
    await bot.sendMessage(chatId, "Error generating evaluation. Please try again.");
  }
}

// Admin panel functions
async function showAdminPanel(chatId, userId) {
  if (userId !== ADMIN_ID) {
    await bot.sendMessage(chatId, "You don't have admin privileges.");
    return;
  }
  
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Grant Access", callback_data: "grant_access" }],
        [{ text: "View Users", callback_data: "view_users" }],
        [{ text: "Back to Tasks", callback_data: "back_to_tasks" }]
      ]
    }
  };
  
  await bot.sendMessage(chatId, "Admin Panel:", keyboard);
}

async function promptForUserId(chatId) {
  await bot.sendMessage(chatId, "Please enter the user ID you want to grant access to:", {
    reply_markup: {
      force_reply: true
    }
  });
  
  // Listen for the reply
  bot.once('message', async (msg) => {
    if (msg.reply_to_message && msg.reply_to_message.text.includes("grant access to")) {
      const userId = parseInt(msg.text);
      if (isNaN(userId)) {
        await bot.sendMessage(chatId, "Invalid user ID. Please enter a number.");
        return;
      }
      
      try {
        const users = db.collection('users');
        await users.updateOne(
          { user_id: userId },
          { $set: { has_access: true } },
          { upsert: true }
        );
        
        await bot.sendMessage(chatId, `Access granted for user ${userId}`);
        await bot.sendMessage(userId, "Admin has granted you access to all tasks!");
      } catch (error) {
        console.error('Error granting access:', error);
        await bot.sendMessage(chatId, "Error granting access. Please try again.");
      }
    }
  });
}

// Start the bot
console.log('Bot is running...');
const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const request = require('request');
const http = require('http');

// Initialize using signing secret from environment variables to receive events
const { createEventAdapter } = require('@slack/events-api');
const slackEvents = createEventAdapter(process.env.SLACK_SIGNING_SECRET);

//Schedule tasks
var schedule = require('node-schedule');

const port = process.env.PORT || 5000;
const URL_SLACK_CHANNEL = process.env.SLACK_URL_CHANNELS || 'localhost';
const SLACK_URL_USERS = process.env.SLACK_URL_USERS || 'localhost';
const SLACK_URL_INFO_USERS = process.env.SLACK_URL_INFO_USERS || 'localhost';
const TIMEOUT_CONVERSATION = process.env.TIMEOUT_CONVERSATION || 1000;
// Type 2: Persistent datastore with manual loading
var Datastore = require('nedb')
  , db = new Datastore({ filename: './database', autoload: true });

db.current_receivers = new Datastore('./receivers.db');
db.current_senders = new Datastore('./senders.db');
db.current_receivers.loadDatabase();
db.current_senders.loadDatabase();

app.set('port', port);

app.use('/slack/events', slackEvents.expressMiddleware());
app.use(express.static(__dirname + '/public'));
app.use(bodyParser.urlencoded({ extended: false }));

// Attach listeners to events by Slack Event "type". See: https://api.slack.com/events/message.im
slackEvents.on('message', (event)=> {
  console.log(`Received a message event: user ${event.user} in channel ${event.channel} says ${event.text}`);
  console.log(event.text.substring(0,2));
  if(event && event.user && event.text.substring(0,2)=== '<@') {
    console.log('Sending messages');
    var splitted = event.text.split(" ");
    console.log(splitted);

    if (splitted.length <= 1) {
        return createError(getUsageHelp(command));
    }

    var target = splitted[0].substring(2, splitted[0].length - 1);
    console.log(target);

    var remainingText = splitted.slice(1).join(' ');
    remainingText = `Someone said: ${remainingText}`;
    console.log(target);
    request({
      uri: `${SLACK_URL_INFO_USERS}?user=${event.user}&pretty=1`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.TOKEN}`
      }
    }, (error, res) => {
      if(res) {
        console.log(res.body)
        const sender_name= JSON.parse(res.body).user.name;

        db.find({ sender_name: `@${sender_name}`,
                 sender: event.user,
                 receiver: target }, function(err, docs) {
          if(docs && docs.length <= 0) {
              console.log('There is a session with the person')
              request({
                  uri: `${SLACK_URL_INFO_USERS}?user=${target}&pretty=1`,
                  method: 'GET',
                  headers: {
                    'Authorization': `Bearer ${process.env.TOKEN}`
                  }
                }, (error, response2) => {
                  const receiver_name= JSON.parse(response2.body).user.name;
                  db.count({}, function(countRegisters, errorCountRegisters) {
                    const chatId = countRegisters ? countRegisters + 1 : 1;
                    saveSession({ name: chatId,
                                  sender_name: `@${sender_name}`,
                                  sender: event.user,
                                  receiver: target,
                                  receiver_name: `@${receiver_name}`})
                    const payloadInitConversation = { channel: target,
                                                      text: `Start an anonymous chat with ${chatId}`}

                    senderMessages(payloadInitConversation);
                    const payloadOption = { channel: target, text: remainingText }
                    senderMessages(payloadOption);
                  });


                });
          } else {
            console.log('sending messages');
            const payloadOption = { channel: target, text: remainingText }
            senderMessages(payloadOption);
          }
        });


      }

    })

  } else {
    db.find({receiver: event.user }, function(err, docs) {
      if(docs && docs[0] && docs[0].sender_name) {
        console.log(docs);
        const payloadOption = { channel: docs[0].sender_name, text: `${docs[0].receiver_name} says: ${event.text}` }

        senderMessages(payloadOption, '', docs);
      }
    })
  }
});

// Handle errors (see `errorCodes` export)
slackEvents.on('error', console.error);

const createError = (errorMessage) => {error: errorMessage};

const getUsageHelp = (commandName) => {
    const createSample = (target) => { commandName + ' *' + target + '* I know what you did last summer' }

    return 'Expected usage: \n' +
        commandName + ' help -- Displays help message.\n' +
        createSample('@user') + ' -- Sends to the specified user.\n' +
        createSample('#channel') + ' -- Sends to the specified public channel.\n' +
        createSample('group') + ' -- Sends to the specified private group.\n' +
        createSample(':here') + ' -- Sends to the current group/channel/DM where you type this command.';

}

const getFullHelp = (commandName) =>
        'Allows to send anonymous messages to users, channels and groups.\n' +
        'The most convenient and safe way is to open up a conversation with slackbot in Slack and type the commands there, so that nobody detects that you are typing and you don\'t accidentally reveal yourself by typing an invalid command.\n' +
        'Messages and authors are not stored, and the sources are available at <https://github.com/TargetProcess/slack-anonymous>.\n' +
        '\n' +
        getUsageHelp(commandName);

const createResponsePayload = (requestBody) => {
  if (!requestBody) {
      return createError('Request is empty');
  }

  var text = requestBody.text;
  var command = requestBody.command;

  if (!text || text === 'help') {
      return createError(getFullHelp(command));
  }

  var splitted = text.split(" ");
  if (splitted.length <= 1) {
      return createError(getUsageHelp(command));
  }

  var target = splitted[0];
  var remainingText = splitted.slice(1).join(' ');
  remainingText = `Someone said: ${remainingText}`;

  if (target === ':here') {
      return {
          channel: requestBody.channel_id,
          text: remainingText
      };
  }
  console.log(requestBody.channel_id);

  return {
      channel: target,
      text: remainingText
  };

}

app.post('/', (req, response) => {
  var payloadOption = createResponsePayload(req.body);
  if (payloadOption.error) {
      response.end(payloadOption.error);
      return;
  }
  // contains
  /*
      { user_id: XXXXX,
    }
  */

  console.log(`Someone with the user_id ${req.body.user_id} is trying to send to ${payloadOption.channel}`);

  if(payloadOption.channel[0]==='@') {
    request({
        uri: `${SLACK_URL_INFO_USERS}?user=${req.body.user_id}&pretty=1`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${process.env.TOKEN}`
        }
      }, (error, res) => {
        db.find({sender_name: `@${JSON.parse(res.body).user.name}`,
                 sender: req.body.user_id,
                 receiver: payloadOption.channel}, function(err, docs) {

                    if(docs && docs.length > 0) {
                      response.end(`You have a chat or the person has a open chat`);

                    }

        });

        saveSession({sender_name: `@${JSON.parse(res.body).user.name}`,
                     sender: req.body.user_id,
                     receiver_name: payloadOption.channel});

      });
  }

  senderMessages(payloadOption, response);
});

app.get('/', (request, response) => {
    response.write('HELLO THERE');
    response.end();
});

const senderMessages = (payloadOption, response, doc) => {
  let url;
  if(payloadOption.channel[0] === '#') {
    payloadOption.as_user=false;

  } else {
    payloadOption.as_user=true;

  }

  request({
      uri: URL_SLACK_CHANNEL,
      method: 'POST',
      json: payloadOption,
      headers: {
        'Authorization': `Bearer ${process.env.TOKEN}`
      }
  },  (error, res) => {
      if(error) {
        console.log(error)
        if (response) {
          response.end(`Unable to post your anonymous message ${JSON.stringify(error)}`);
        }
      } else {
        if (response) {
          response.end('Delivered! :cop:');
          db.update(doc, {date: new Date()},function(){

          });
        }
      }
  });
}

const saveSession = (data) => {
      db.insert({ name: data.name,
                 sender: data.sender,
                 sender_name: data.sender_name,
                 receiver: data.receiver,
                 receiver_name: data.receiver_name,
                 date: new Date() }, function (err, docs) {
                   if(err) {
                     console.log(err);
                   }
                 });

}


http.createServer(app).listen(port, () => {
  console.log(`server listening on port ${port}`);
});

var j = schedule.scheduleJob('* * * * *', function(fireDate){
  console.log('This job was supposed to run at ' + fireDate + ', but actually ran at ' + new Date());
  db.find({}, function(error, docs) {
    docs.forEach(doc => {
      console.log(`Analising:`);
      console.log(doc);
      console.log(new Date() - doc.date);
      if((new Date() - doc.date) > TIMEOUT_CONVERSATION) {
        const finishMessageSender = { channel: doc.sender_name,
                                          text: `Finish an anonymous chat with ${doc.receiver_name}`}
        senderMessages(finishMessageSender);
        const finishMessageReceiver = { channel: doc.receiver_name,
                                          text: `Finish an anonymous chat with ${doc.name}`}
        senderMessages(finishMessageReceiver);

        db.remove({ _id: doc._id }, {}, function (err, numRemoved) {
          // numRemoved = 1
        });
      }
    })
  })
});

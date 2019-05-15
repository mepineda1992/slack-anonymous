const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const request = require('request');
const http = require('http');
const async = require('async');
const waterfall = require('async/waterfall');


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
  let payloadInitConversation, payloadOption;

  if(event && event.user && event.text.substring(0,2)=== '<@') {
    console.log('Sending messages');
    var splitted = event.text.split(" ");
    console.log(splitted);

    if (splitted.length <= 1) {
        return createError(getUsageHelp(command));
    }

    var target = splitted[0].substring(2, splitted[0].length - 1);
    var remainingText = splitted.slice(1).join(' ');
    console.log(target);

    async.waterfall([
        function(callback) {
          requestSlack(`${SLACK_URL_INFO_USERS}?user=${event.user}&pretty=1`, 'GET')
            .then(res => {
              if(res && !res.error) {
                console.log(res.body)
                const sender_name= JSON.parse(res.body).user.name;

                callback(null, sender_name)
              }

              throw new Error(`The request wasn't works, ${res.error}`)
            })
            .catch(err => {throw new Error(err.toString())})
        },
        function(sender_name, callback) {
          if(sender_name) {
            findRegisters(
              db,
              { sender_name: `@${sender_name}`,
                sender: event.user,
                receiver: target }).then(doc => {
                  callback(null, doc, sender_name)
                });
          }

          throw new Error(`There aren't args`)
        },
        function(args, sender_name, callback) {
          if(args && !args.sender_name && !args.receiver_name) {
            requestSlack(`${SLACK_URL_INFO_USERS}?user=${event.user}&pretty=1`, 'GET')
              .then(res => {
                if(res) {
                  const receiver_name= JSON.parse(response2.body).user.name;
                  const display_receiver_name = JSON.parse(response2.body).user.profile.display_name_normalized;
                  callback(null, receiver, display_receiver_name);
                }
              })

          } else {
            console.log('sending messages');
            const payloadOption = { channel: target,
                                    text: `Someone with anonymous id ${args.name} said: ${remainingText}` }
            senderMessages(payloadOption)
            .then(() => callback())
            .catch(err => console.log('Error sending an anonymous message with already register'));

          }
        },
        function(receiver_name, display_receiver_name, sender_name, callback) {
          let chatId;
          if(receiver_name && display_receiver_name) {
            findRegisters({})
              .then(res => {
                const idRegister = (res && res.length > 0) ?res.length + 1: 1;
                chatId = `${parseInt(Math.random() * (1000 - 1) + 1)}${idRegister}`
                return saveSession( db,
                                    {name: chatId,
                                    sender_name: `@${sender_name}`,
                                    sender: event.user,
                                    receiver: target,
                                    receiver_name: `@${receiver_name}`,
                                    display_receiver_name: `@${display_receiver_name}`})
              })
              .then(newDocs => {
                if(newDoc) {
                  payloadInitConversation = { channel: target,
                                              text: `Start an anonymous chat with ${chatId}`}

                  return findRegisters(db.current_receivers, {receiver: target})
                }
              })
              .then(newCurrentReceiver => {
                if(newCurrentReceiver) {
                  db.current_receivers.insert({ receiver: target, current_session: chatId });
                  return senderMessages(payloadInitConversation)
                }

              })
              .then(resSender => {
                console.log(`Message was already sent ${resSender}`);
                payloadOption = { channel: target,
                                  text: `Someone with anonymous id ${chatId} said: ${remainingText}` }
                return senderMessages(payloadOption);

              })
              .then(() => {
                console.log('Sender message');
                callback();
              })
              .catch(err => console.log(`There is an error, god help me`));

          }
        }
    ], function (err, result) {
        // result now equals 'done'
        console.log('Done')
        console.log(result)
        if(err) {
          console.log(err)
        }
    });
  } else {
    let payloadOption;
    db.find({receiver: event.user }, function(err, docs) {
      if(docs && docs.length === 1 && docs[0].sender_name) {
        let remainingText = event.text;
        if(event.text.split(" ")[0].substring(event.text.split(" ")[0].length - 4 , event.text.split(" ")[0].length) === '&gt;') {
          var splitted = event.text.split(" ");
          remainingText = splitted.slice(1).join(' ');

        }

        payloadOption = { channel: docs[0].sender_name, text: `${docs[0].display_receiver_name} says: ${remainingText}` }
        senderMessages(payloadOption, '', docs);
      } else {
        var splitted = event.text.split(" ");
        console.log(splitted);
        if(docs && docs.length > 1 && splitted[0].substring(splitted[0].length - 4, splitted[0].length) === '&gt;') {
          var splitted = event.text.split(" ");
          if (splitted.length <= 1) {
              return createError(getUsageHelp(command));
          }
          var session = splitted[0].substring(0, splitted[0].length - 4);
          console.log(`Esto es la session ${session}`);
          var remainingText = splitted.slice(1).join(' ');

          const currentSender = docs.find(doc => doc.name === session);
          if(currentSender) {
            payloadOption = { channel: currentSender.sender_name, text: `${currentSender.receiver_name} says: ${remainingText}` }

            db.current_receivers.find({receiver: currentSender.receiver}, function(errorReceiver, docsReceiver) {
              db.current_receivers.update({_id: docsReceiver[0]._id},
                                          {$set: {receiver: currentSender.receiver, current_session: session}},
                                          {}, function (err, numReplaced) {

                                            if(payloadOption) {
                                              console.log(payloadOption);
                                              senderMessages(payloadOption);
                                            }
              });
            });
          }
        } else if (docs && docs.length > 1) {
          db.current_receivers.find({receiver: event.user}, function(errorReceiver, receivers) {
            console.log(docs);
            console.log(receivers);
            const currentSender = docs.find(doc => doc.name === receivers[0].current_session);
            payloadOption = { channel: currentSender.sender, text: `${currentSender.display_receiver_name} says: ${event.text}` }
            console.log(currentSender);
            senderMessages(payloadOption);

          });
        }
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
  requestSlack(URL_SLACK_CHANNEL, 'POST', payloadOption)
    .then(res => {
      if(response && res && !res.error) {
        response.end('Delivered! :cop:');
        db.update(doc, {$set:{date: new Date()}},function(){

        });

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
          db.find({receiver: doc.receiver}, function(errorReceiver, docsNewReceiver) {
            if(docsNewReceiver) {
              db.current_receivers.find({receiver: docsNewReceiver[0].receiver}, function(errorReceiver, docsLastReceiver) {
                db.current_receivers.update({_id: docsLastReceiver[0]._id},
                                            {$set:{receiver: docsNewReceiver[0].receiver, current_session: docsNewReceiver[0].name}},
                                            {}, function (err, numReplaced) {
                    const payloadOptionNotification = { channel: docsNewReceiver[0].receiver,
                                                      text: `You are switched to ${docsNewReceiver[0].name}`}
                    senderMessages(payloadOptionNotification);
                });
              });

            }
          });
        });
      }
    })
  })
});

const findRegisters = (currentDb, query) =>
   new Promise((resolve) => {
    currentDb.find(query)
      .exec((err, docs) => {
        resolve(
          docs && docs.length > 1 ? docs : docs[0]
        );
      });
  });

const saveSession = (currentDb, data) =>
  new Promise((resolve) => {
    currentDb.insert({
      name: data.name,
      sender: data.sender,
      sender_name: data.sender_name,
      receiver: data.receiver,
      receiver_name: data.receiver_name,
      display_receiver_name: data.display_receiver_name,
      date: new Date() }, function (err, docs) {
        resolve(docs);

      })
  });

const removeRegisters = (currentDb, id) =>
  new Promise((resolve) => {
    currentDb.remove({
      _id: id
    }, {}, function(err, docs) {
      resolve(docs);
    })
  });

const updateRegisters = (currentDb, doc, newDoc) =>
  new Promise((resolve) => {
    currentDb.update(
      { _id: doc._id },
      { $set: {newDoc}},
      {}, function(err, updated) {
        resolve(updated);
      })
  });

const requestSlack = (url, method, payload) =>
  new Promise((resolve) => request({
    uri: url,
    method: method,
    json: payload,
    headers: {
      'Authorization': `Bearer ${process.env.TOKEN}`
    }
  }, (err, res) => resolve(res && res.body)))


async.waterfall([
    function(callback) {
      requestSlack(`${SLACK_URL_INFO_USERS}?user=@mepineda1992&pretty=1`, 'GET')
        .then(res => {
          if(!res.error) {
            callback(null, res)
          }

          throw new Error(`The request wasn't works, ${res.error}`)
        })
        .catch(err => {throw new Error(err.toString())})
    },
    function(arg1, callback) {
      if(!arg1.error) {
        saveSession(db, {sender: arg1.user})
          .then((res)=> callback(null, res))
          .catch(err => console.log(err));
      }

      throw new Error(`There aren't args`)
    }
], function (err, result) {
    // result now equals 'done'
    console.log('Done')
    console.log(result)
    if(err) {
      console.log(err)
    }
});

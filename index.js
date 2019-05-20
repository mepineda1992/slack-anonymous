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
  if(event.text.indexOf('has joined the group') >= 0 ||
     event.text.indexOf('has left the group') >= 0) {
    console.log('It is not a valid message');

  } else {
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

      senderMessageSlack(target, remainingText, event);

    } else {
      const res = receiverMessageSlack(event.user, event.channel, event.text);
      console.log(`esta es l respuesta ${res}`);
    }
  }

});


const receiverMessageSlack = (receiver, channel_id_receiver, remainingText) => {

  async.waterfall([
    function(callback) {
      findRegisters(
        db,
        { receiver: receiver,
          channel_id_receiver: channel_id_receiver,
        })
      .then(docs => {
        if(docs) {
          console.log(`Registers ${docs}`);
          callback(null, docs)
        }

      });
    },
    function(args, callback) {
      if(args) {
        payloadOption = { channel: args.channel_id_sender,
                          text: `${args.display_receiver_name} says: ${remainingText}`,
                          as_user: true }

        requestSlack('https://slack.com/api/chat.postMessage', 'POST', payloadOption)
        .then(res => {
          if(res) {
            console.log(res && res.body);
            callback()
          }
        })
      }
    }
  ], function (err, result) {
      // result now equals 'done'
      console.log('Done')
      console.log(result)
      return 'done';
      if(err) {
        console.log(err)
      }
  })
}

const senderMessageSlack = (target, remainingText, event) => {

  async.waterfall([
      function(callback) {
        requestSlack(`${SLACK_URL_INFO_USERS}?user=${event.user}&pretty=1`, 'GET')
          .then(res => {
            if(res && !res.error) {
              const sender_name= JSON.parse(res.body).user.name;
              console.log(sender_name)

              callback(null, sender_name)
            }

            callback();
          })
          .catch(err => { console.log(`Error with request ${err}`)})
      },
      function(sender_name, callback) {
        console.log(`Searching in the database ${sender_name}`);
        if(sender_name) {
          findRegisters(
            db,
            { sender_name: `@${sender_name}`,
              sender: event.user,
              receiver: target })
          .then(doc => {
            console.log(`Registers ${doc}`);
            callback(null, doc, sender_name)

          });
        }

      },
      function(args, sender_name, callback) {
        console.log(`Sending or saving sessionID ${args}, ${sender_name}`);

        if(!args && sender_name) {
          console.log("Information about the receiver")
          requestSlack(`${SLACK_URL_INFO_USERS}?user=${target}&pretty=1`, 'GET')
            .then(res => {
              if(res) {
                console.log(res.body);

                const receiver_name= JSON.parse(res.body).user.name;
                const display_receiver_name = JSON.parse(res.body).user.profile.display_name_normalized;
                console.log(`Responde ${receiver_name}, ${display_receiver_name}`);

                callback(null, receiver_name, display_receiver_name, sender_name);
              }
            })

        } else {
          console.log('sending messages');
          payloadOption = { channel: args.channel_id_receiver,
                            text: `Someone with anonymous id ${args.name} said: ${remainingText}`,
                            as_user: true }

          requestSlack('https://slack.com/api/chat.postMessage', 'POST', payloadOption)
          .then((r) =>
            callback())
          .catch(err => console.log('Error sending an anonymous message with already register'));

        }

      },
      function(receiver_name, display_receiver_name, sender_name, callback) {
        let chatId;
        console.log("Saving registers to database");
        if(receiver_name && sender_name) {
          let channel_id_receiver;
          let channel_id_sender;

          findRegisters(db, {})
            .then(newDocs => {
                const idRegister = (newDocs && newDocs.length > 0) ?newDocs.length + 1: 1;
                chatId = `${parseInt(Math.random() * (1000 - 1) + 1)}${idRegister}`
                console.log(chatId);

                console.log(`creating channel for ${target}`);
                return requestSlack(`https://slack.com/api/conversations.create?user_ids=${target}`, 'POST', { is_private: true, name: `rec${chatId}`}, true)
              })
              .then((res) => {
                console.log(res && res.body);

                if(res) {
                  channel_id_receiver=res.body.channel.id;
                }

                console.log(`Inviting  ${target} , ${process.env.BOT_ID} to ${channel_id_receiver}`);
                return requestSlack(`https://slack.com/api/conversations.invite`, 'POST', {users:`${target},${process.env.BOT_ID}`, channel: channel_id_receiver,force:true }, true)

              })
              .then((res) =>{
                console.log('Securiting');
                console.log(res && res.body);

                if(res && target != process.env.USER_ADMIN) {
                  return requestSlack('https://slack.com/api/conversations.leave','POST', {channel: channel_id_receiver}, true)
                }
              })
              .then((res) => {
                console.log(res && res.body);

                console.log(`creating channel for ${event.user}`);
                return requestSlack(`https://slack.com/api/conversations.create?user_ids=${event.user}`, 'POST', {is_private: true, name: `sen${chatId}` }, true)

              })
              .then((res) => {
                console.log(res && res.body);
                if(res) {
                  channel_id_sender = res.body.channel.id;
                }

                console.log(`Inviting  ${target} , ${process.env.BOT_ID} to ${channel_id_receiver}`);
                return requestSlack(`https://slack.com/api/conversations.invite`, 'POST', {users:`${event.user},${process.env.BOT_ID}`, channel: channel_id_sender,force:true }, true)

              })
              .then((res) =>{
                console.log('Securiting');

                if(res && event.user != process.env.USER_ADMIN) {
                  return requestSlack('https://slack.com/api/conversations.leave','POST', {channel: channel_id_sender}, true)
                }
              })
              .then(res => {
                console.log(res && res.body);
                return saveSession( db,
                                    {name: chatId,
                                    sender_name: `@${sender_name}`,
                                    sender: event.user,
                                    receiver: target,
                                    receiver_name: `@${receiver_name}`,
                                    display_receiver_name: `@${display_receiver_name}`,
                                    channel_id_sender: channel_id_sender,
                                    channel_id_receiver: channel_id_receiver })
              })
              .then(res => {
                payloadInitConversation = { channel: channel_id_receiver, text: `Someone start a chatId ${chatId}`,
                                            as_user: true }
                console.log(payloadInitConversation);

                return requestSlack('https://slack.com/api/chat.postMessage', 'POST', payloadInitConversation)

              })
            .then(resSender => {
              console.log(`Message was already sent ${resSender} ${target} ${chatId}`);

              payloadOption = { channel: channel_id_receiver,
                                text: `Someone with anonymous id ${chatId} said: ${remainingText}`,
                                as_user: true }

              return requestSlack('https://slack.com/api/chat.postMessage', 'POST', payloadOption)

            })
            .then((r) => {
              console.log('Sender message');
              callback();
            })
            .catch(err => console.log(`There is an error, god help me ${err}`));

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

}
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
      channel_id_sender: data.channel_id_sender,
      channel_id_receiver: data.channel_id_receiver,
      date: new Date() }, function (err, docs) {
        resolve(docs);

      })
})

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

const requestSlack = (url, method, payload, pointer) => {
  console.log(`Este es el pointer the pointers ${pointer}`);
  let token = pointer ? process.env.TOKEN_USER : process.env.TOKEN_BOT;
  console.log(`TOKEN: ${token}`);

  return new Promise((resolve) => request({
    uri: url,
    method: method,
    json: payload,
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }, (err, res) => resolve(res)))}

http.createServer(app).listen(port, () => {
  console.log(`server listening on port ${port}`);
});

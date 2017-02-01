var config = require('config');
var async = require('async');
var request = require('request');
var qs = require('qs');
var express = require('express')
var firebase = require('firebase');
var VK = require('vksdk');
var path    = require("path");
var bodyParser = require('body-parser');

var app = express();
var dbConfig = {
  apiKey: config.vk.dbtoken,
  authDomain: config.vk.authDomain,
  databaseURL: config.vk.firebaseLink
};

firebase.initializeApp(dbConfig);
console.log(firebase.app().name);
var database = firebase.database().ref();




var vk = new VK({
   'appId'     : config.vk.appId,
   'appSecret' : config.vk.appSecret,
   'language'  : 'ru'
});


app.set('views', __dirname);
app.use(bodyParser.json());

vk.setSecureRequests(true);
vk.setVersion('5.62');


vk.on('http-error', function(_e) {
    console.log('http-error: '+ _e);
});

vk.on('parse-error', function(_e) {
    console.log("parse-error" + _e);
});

function getAttachmentsStr(attachments) {
    var attachmentsStr = '';
    var postLink = '';
    var flag = 0;
    if ('link' in attachments) {
        postLink = postLink + attachments[attachments.type].url;
    }
    attachments.forEach(function(item, i) {
        if (attachmentsStr.length > 0) {
            attachmentsStr = attachmentsStr + ',';
        }
        
        if (item.type == 'link') {
            attachmentsStr = attachmentsStr + item[item.type].url;
        } else {
            attachmentsStr = attachmentsStr + item.type + item[item.type].owner_id + '_' + item[item.type].id; 
        }
    });
    return attachmentsStr;
}




function postsToRepost(postsToAdd) {

    //sorting by likes
    postsToAdd.sort(function(postOne, postTwo) {
        return postTwo.likes.count - postOne.likes.count;
    });

    //define total amount of likes
    var totalLikes = postsToAdd.reduce(function(last, next) {
        return last += next.likes.count;
    }, 0);

    //proportion for each post in total likes
    var postsLikesProportion = postsToAdd.map(function(post, i) {
        return { id: i + 1, likesProportion: 100 * post.likes.count / totalLikes, count: post.likes.count };
    });

    for (var i = postsLikesProportion.length - 2; postsLikesProportion[i]; i--) {
        postsLikesProportion[i].likesProportion += postsLikesProportion[i + 1].likesProportion;
    }

    var numberOfPosts = postsLikesProportion.filter(function(percent) {
        return percent.likesProportion > 70;
    });

    return numberOfPosts.length > 10 ? 10 : numberOfPosts.length;
}








app.get('/authorize', function(req, res) {
   //for now has access_token has to be inserted manually
   var access_token = ''
   
   vk.setToken(access_token);


   vk.request('wall.get', { owner_id : config.vk.targetGroupId, offset : 0, count : 1}, function(post) {

    console.log('wall.get: ');
 
    var lastPostAddTime = post.response.items[0].date;
    console.log(lastPostAddTime);

    async.eachSeries(config.vk.pullGroupIds, function(groupId, nextGroup) {

        //get set of posts from targeted group that were added after last post from my group (up to 50)
        vk.request('wall.get', {owner_id : groupId, offset : 1, count : 50}, function(posts) {



                console.log('get group id: '+groupId.toString());
             database.child(groupId.toString()).once('value', function (snapshot) {

                var lastAddedPostTime = 0;
                console.log('check the last time db was created');

                if (!snapshot.val()) {
                    database.child(groupId).set({lastAddedPostTime : 0});
                } else {
                    lastAddedPostTime = snapshot.val().lastAddedPostTime;
                }

                var postsToAdd = posts.response.items.filter(function(post) {
                    return post.date > lastAddedPostTime;
                });

               database.child(groupId).update({lastAddedPostTime : posts.response.items[0].date});

                if (!postsToAdd.length) {
                    console.log('nothing to add');
                    nextGroup();
                    return;
                }

                console.log('The last post was added at: ' + lastAddedPostTime + ', amount of post is: ' + postsToAdd.length);



                var numberOfPostsToPost = postsToRepost(postsToAdd);

                console.log(numberOfPostsToPost + ' posts will be added');

                async.eachSeries(postsToAdd.slice(0, numberOfPostsToPost), function(post, next) {

                    var attachmentsStr;

                    if (post.attachments) {
                        var attachmentsStr = getAttachmentsStr(post.attachments);
                    } else {
                        var attachmentsStr = '';
                    }


                    vk.request('wall.post', {
                        'owner_id': config.vk.targetGroupId,
                        'from_group': 1,
                        'message': post.text,
                        'access_token': access_token,
                        'attachments': attachmentsStr,
                    }, function(err) {
                        if (err) {
                            console.log('POST MSG:', err);
                        }

                        setTimeout(next, 1000);
                    });

                }, function(err) {
                    if (err) {
                        console.log('POST MSG:', err);
                        nextGroup(err);
                        return;
                    }

                    console.log('GROUP DONE!!!');
                    nextGroup();
                });
            });
        });
    }, function(msg) {
        if (msg) {
            console.log('Group complete msg:', msg);
            return;
        }

        console.log('Finished processing groups');
        process.exit();
    }); 
 });
});


app.get('/index', function(req, res){ 
    res.sendFile(path.join(__dirname + '/index.html'));
});

app.get('/', function (req, res) {
  res.redirect('https://oauth.vk.com/authorize?client_id=5816817&display=page&redirect_uri=https://oauth.vk.com/blank.html&scope=wall,groups,friends,offline&response_type=token&v=5.62');
});

app.listen(3000);

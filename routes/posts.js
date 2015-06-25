var Post = require('../models/Post'),
    Topic = require('../models/Topic'),
    State = require('../models/State'),
    Priority = require('../models/Priority'),
    Forum = require('../models/Forum'),
    Site = require('../models/Site'),
    postsSearch = require('./posts/search'),
    postsComments = require('./posts/comments'),
    Q = require("q"),
    marked = require('marked'),
    slug = require('slug');

/**
 * Set Markdown parser settings
 */
marked.setOptions({
  renderer: new marked.Renderer(),
  gfm: true,
  tables: true,
  breaks: false,
  pedantic: false,
  sanitize: true,
  smartLists: true,
  smartypants: true
});

/**
 * Return list of topics
 * GET /posts/
 */
exports.getTopics = function(req, res) {
  return res.redirect('/'+Site.options().post.slug+'/everything');
};

/**
 * GET /posts/:topic
 */
exports.getPosts = function(req, res) {

  var page = (parseInt(req.query.page) > 1) ? parseInt(req.query.page) : 1;

  var options = { };
  
  // If a forum is specified, filter by forum
  if (req.params.forum) {
    Forum
    .findOne({ slug: req.params.forum })
    .exec(function(err, forum) {
      if (err) return next(err);
      
      // If Forum not found return 404
      if (!forum)
        return res.render('404');
      
      options.forum = forum;

      if (req.params.topic && req.params.topic != "everything") {
        // If there is a topic (and it's not 'everything') filter by topic
        Topic
        .findOne({ slug: req.params.topic })
        .exec(function(err, topic) {
          if (err) return next(err);

          // If Topic not found return 404
          if (!topic)
            return res.render('404');

          options.topic = topic;
      
          return _getPosts(req, res, options, page);
        });
      } else {
        // If not topic, return all posts for this forum
        return _getPosts(req, res, options, page);
      }
    });
  } else {
    // If there is no forum but there is a topic (and it's not 'everything'),
    // then filter by topic.
    if (req.params.topic && req.params.topic != "everything") {
      Topic
      .findOne({ slug: req.params.topic })
      .exec(function(err, topic) {
        if (err) return next(err);

        // If Topic not found return 404
        if (!topic)
          return res.render('404');
        
        options.topic = topic;
          
        return _getPosts(req, res, options, page);
      });
    } else {
      // If there is no specific forum and no topic specified return everything
      return _getPosts(req, res, options, page);
    }
  }

};

/**
 * GET /posts/:topic/new
 */
exports.getNewPost = function(req, res) {
  if (req.params.forum) {
    // Forum specified
    Forum
    .findOne({ slug: req.params.forum })
    .exec(function(err, forum) {
      if (err) return next(err);
      if (req.params.topic) {
        // Forum AND topic specified
        Topic
        .findOne({ slug: req.params.topic })
        .exec(function(err, topic) {
          if (err) return next(err);
          res.render('posts/new', { title: "New", forum: forum, topic: topic, post: new Post(), newPost: true});
        });
      } else {
        // Forum specified, but not topic
        res.render('posts/new', { title: "New", forum: forum, topic: null, post: new Post(), newPost: true });
      }
    });
  } else {
    if (req.params.topic) {
      // Topic spcified, but not forum
      Topic
      .findOne({ slug: req.params.topic })
      .exec(function(err, topic) {
        if (err) return next(err);
        res.render('posts/new', { title: "New", forum: null, topic: topic, post: new Post(), newPost: true});
      });
    } else {
      // Neither forum or topic spcified
      res.render('posts/new', { title: "New", forum: null, topic: null, post: new Post(), newPost: true });
    }
  }
};

/**
 * POST /posts/:topic/new
 */
exports.postNewPost = function(req, res, next) {
  req.assert('summary', 'Summary cannot be blank').notEmpty();
  req.assert('detail', 'Detail cannot be blank').notEmpty();
  
  var errors = req.validationErrors();

  if (req.headers['x-validate'])
    return res.json({ errors: errors });
  
  if (errors) {
    if (req.xhr || req.api)
      return res.json({ errors: errors });
    req.flash('errors', errors);
    return res.render('posts/new');
  }
  
  var post = new Post({
    summary: req.body.summary,
    detail: req.body.detail,
    tags: splitTags(req.body.tags),
    creator: req.user.id
  });
  
  if (req.body.forum && req.body.forum != 0)
    post.forum = req.body.forum;
  
  if (req.body.topic && req.body.topic != 0)
    post.topic = req.body.topic;

  if (req.body.state && req.body.state != 0)
    post.state = req.body.state;

  if (req.body.priority && req.body.priority != 0)
    post.priority = req.body.priority;
  
  post.save(function(err) {
    if (err) return next(err);

    // Fetch back from DB so topic is properly populated for the page template
    Post
    .findOne({ postId: post.postId })
    .populate('creator', 'profile')
    .populate('comments.creator', 'profile')
    .populate('forum')
    .populate('topic')
    .populate('state')
    .populate('priority')
    .exec(function(err, post) {
      if (req.xhr || req.api) {
        return res.json(post);
      } else {
        return res.redirect(post.getUrl());
      }
    });
    
  });
};

/**
 * GET /posts/:topic/:id
 */
exports.getPost = function(req, res) {
  var postId = req.params.id;
  
  Post
  .findOne({ postId: postId })
  .populate('creator', 'profile')
  .populate('comments.creator', 'profile')
  .populate('forum')
  .populate('topic')
  .populate('state')
  .populate('priority')
  .exec(function(err, post) {
    if (err || (post.deleted && post.deleted == true))
        return res.render('404');

    if (req.xhr || req.api) {
      // If it's an AJAX or API request, return a JSON response
      res.json(post);
    } else {
      // If it's not an AJAX request, parse body and comments for markdown
      // (if markdown option is enabled)
      if (Site.options().post.markdown == true) {
        post.detailHtml = marked(post.detail);
        post.comments.forEach(function(comment) {
          comment.messageHtml = marked(comment.message);
        });
      }
      // Look for and add similar posts
      Post.mlt(post._id, { deleted: false }, null,  null, function(err, similar) {
        return res.render('posts/view', { title: post.summary, post: post, forum: post.forum, topic: post.topic, similar: similar });
      });
    }
  });
};

/**
 * GET /posts/:topic/edit/:id
 */
exports.getEditPost = function(req, res) {
  var postId = req.params.id;

  Post
  .findOne({ postId: postId })
  .populate('creator', 'profile role')
  .populate('comments.creator', 'profile')
  .populate('forum')
  .populate('topic')
  .populate('state') 
  .populate('priority')
  .exec(function(err, post) {
    if (err || (post.deleted && post.deleted == true))
      return res.render('404');

    if ((post.creator && req.user.id != post.creator.id)
        && req.user.role != 'MODERATOR'
        && req.user.role != 'ADMIN')
      return res.render('403');

    if (Site.options().post.markdown == true) {
      post.comments.forEach(function(comment) {
        comment.messageHtml = marked(comment.message);
      });
    }

    return res.render('posts/edit', { title: "Edit: " + post.summary, post: post,  forum: post.forum, topic: post.topic });
  });
};

/**
 * POST /posts/:topic/edit/:id
 */
exports.postEditPost = function(req, res, next) {
  req.assert('id', 'Post ID cannot be blank').notEmpty();
  req.assert('summary', 'Summary cannot be blank').notEmpty();
  req.assert('detail', 'Description cannot be blank').notEmpty();

  var errors = req.validationErrors();

  if (req.headers['x-validate'])
    return res.json({ errors: errors });
  
  if (errors) {
    if (req.xhr || req.api)
      return res.json({ errors: errors });
    req.flash('errors', errors);
    return res.redirect('back');
  }
  
  Post
  .findOne({ postId: req.params.id })
  .populate('creator', 'profile role')
  .populate('forum')
  .populate('topic')
  .populate('state')
  .populate('priority')
  .exec(function(err, post) {
    if (err || (post.deleted && post.deleted == true))
      return res.render('404');
    
    if ((post.creator && req.user.id != post.creator.id)
        && req.user.role != 'MODERATOR'
        && req.user.role != 'ADMIN')
      return res.render('403');
    
    post.summary = req.body.summary;
    post.detail = req.body.detail;
    post.tags = splitTags(req.body.tags);

    post.topic = null;
    if (req.body.topic && req.body.topic != 0)
      post.topic = req.body.topic;

    post.state = null;
    if (req.body.state && req.body.state != 0)
      post.state = req.body.state;

    post.priority = null;
    if (req.body.priority && req.body.priority != 0)
      post.priority = req.body.priority;
    
    post.save(function(err) {
      if (err) return next(err);
      // Fetch back from DB so topic is properly populated for the page template
      Post
      .findOne({ postId: post.postId })
      .populate('creator', 'profile')
      .populate('comments.creator', 'profile')
      .populate('forum')
      .populate('topic')
      .populate('state')
      .populate('priority')
      .exec(function(err, post) {
        if (req.xhr || req.api) {
          return res.json(post);
        } else {
          return res.redirect(post.getUrl());
        }
      });
    });
      
  });
};

/**
 * POST /posts/:topic/upvote/:id
 */
exports.postUpvote = function(req, res, next) {
  req.assert('id', 'Post ID cannot be blank').notEmpty();

  var errors = req.validationErrors();

  if (req.headers['x-validate'])
    return res.json({ errors: errors });
  
  if (errors) {
    if (req.xhr || req.api)
      return res.json({ errors: errors });
    req.flash('errors', errors);
    return res.redirect('back');
  }

  Post
  .findOne({ postId: req.params.id })
  .exec(function(err, post) {
    if (err || (post.deleted && post.deleted == true))
      return res.render('404');
    
    post.upvote(req.user.id);
    
    post.save(function(err) {
      if (err) return next(err);
      // If it's an AJAX or API request, return a JSON response
      if (req.xhr || req.api) {
        return res.json({ score: post.upvotes() - post.downvotes(), upvotes: post.upvotes(), downvotes: post.downvotes() });
      } else {
        return res.redirect(req.session.returnTo || post.getUrl());
      }
    });
  });
}

/**
 * POST /posts/:topic/downvote/:id
 */
exports.postDownvote = function(req, res, next) {
  req.assert('id', 'Post ID cannot be blank').notEmpty();

  var errors = req.validationErrors();

  if (req.headers['x-validate'])
    return res.json({ errors: errors });
  
  if (errors) {
    if (req.xhr || req.api)
      return res.json({ errors: errors });
    req.flash('errors', errors);
    return res.redirect('back');
  }

  Post
  .findOne({ postId: req.params.id })
  .exec(function(err, post) {
    if (err || (post.deleted && post.deleted == true))
      return res.render('404');
    
    post.downvote(req.user.id);
    
    post.save(function(err) {
      if (err) return next(err);
      // If it's an AJAX or API request, return a JSON response
      if (req.xhr || req.api) {
        return res.json({ score: post.upvotes() - post.downvotes(), upvotes: post.upvotes(), downvotes: post.downvotes() });
      } else {
        return res.redirect(req.session.returnTo || post.getUrl());
      }
    });
  });
}

/**
 * POST /posts/:topic/unvote/:id
 */
exports.postUnvote = function(req, res, next) {
  req.assert('id', 'Post ID cannot be blank').notEmpty();

  var errors = req.validationErrors();

  if (req.headers['x-validate'])
    return res.json({ errors: errors });
  
  if (errors) {
    if (req.xhr || req.api)
      return res.json({ errors: errors });
    req.flash('errors', errors);
    return res.redirect('back');
  }

  Post
  .findOne({ postId: req.params.id })
  .exec(function(err, post) {
    if (err || (post.deleted && post.deleted == true))
      return res.render('404');
    
    post.unvote(req.user.id);
    
    post.save(function(err) {
      if (err) return next(err);

      // If it's an AJAX or API request, return a JSON response
      if (req.xhr || req.api) {
        return res.json({ score: post.upvotes() - post.downvotes(), upvotes: post.upvotes(), downvotes: post.downvotes() });
      } else {
        return res.redirect(req.session.returnTo || post.getUrl());
      }
    });
  });
}

/**
 * GET /api/topics
 * Returns a list of Topics available to specify for clients using the API
 */
exports.getTopics = function(req, res) {
  Topic
  .find({ deleted: false })
  .exec(function(err, topics) {
    return res.json(topics);
  });
};

/**
 * GET /api/states
 * Returns a list of States available to specify for clients using the API
 */
exports.getStates= function(req, res) {
  State
  .find({ deleted: false })
  .exec(function(err, states) {
    return res.json(states);
  });
};

/**
 * GET /api/priorities
 * Returns a list of Priorities available to specify for clients using the API
 */
exports.getPriorities = function(req, res) {
  Priority
  .find({ deleted: false })
  .exec(function(err, priorities) {
    return res.json(priorities);
  });
};

/**
 * Routes for /posts/:topic/search/*
 */
exports.search = postsSearch;

/**
 * Routes for /posts/:topic/comments/*
 */
exports.comments = postsComments;

/**
 * Function to perform regexs on strings for tags
 * e.g. to split a string like: 'London, "United Kingdom", UK' into an array of
 * strings like ['London', 'United Kingdom', 'UK']
 */
function splitTags(str) {
  if (!str || str.trim() == '')
    return [];
  
  return str.match(/(".*?"|[^",]+)+(?=,*|,*$)/g).map(function(s) { return s.trim().replace(/(^\"|\"$)/g, '').trim() })
};

/**
 * Build query to fetch results
 * @todo support filtering by keywords in combination with options
 * @todo support filtering by arrays of options
 */
function _getPosts(req, res, options, page, limit) {
  
  if (!limit || limit > 100)
    limit = 100;

  var closedStateIds = [];
  var postCount = 0;
  var postTotal = 0;
  
  var skip = 0;
  if (page > 1)
    skip = (page - 1) * limit;

  // Build the query
  var query = { deleted: false };
  
  if (options.forum)
    query.forum = options.forum.id;
  
  if (options.topic)
    query.topic = options.topic.id;
  
  var topics = [];
  
  State
  .find({ deleted: false, open: false })
  .exec(function(err, states) {
    states.forEach(function(state, index) {
      closedStateIds.push(state.id);
    });
    
    // If no state specified, filter by all open states
    if (options.state) {
      query.state = options.state.id;
    } else {
      query.state = { $ne: closedStateIds };
    }
  })
  .then(function() {
    // Get the count for the total number of posts matching the query
    var deferred = Q.defer();
    return Post.count(query, function(err, count) {
      postCount = count;
      deferred.resolve(postCount);
    })
    return deferred.promise;
  })
  .then(function() {
    // Get the count for the total number of open posts in this forum
    var totalOpenQuery = { state: { $ne: closedStateIds } };

    if (options.forum)
      totalOpenQuery.forum = options.forum.id;

    var deferred = Q.defer();
    return Post.count(totalOpenQuery, function(err, count) {
      postTotal = count;
      deferred.resolve(postTotal);
    })
    return deferred.promise;
  })
  .then(function() {
    // Get count for the total number of open posts each topic 
    // (optionally filtered by forum)
    return Topic
    .find({ deleted: false }, null, { sort : { order: 1 } })
    .exec(function(err, topics) {
      return Q.all(topics.map(function(topic) {
        var deferred = Q.defer();
        
        // Get the number of all open posts in each topic
        var topicQuery = { topic: topic._id, state: { $ne: closedStateIds } };
        
        if (options.forum)
          topicQuery.forum = options.forum.id;

        Post.count(topicQuery, function(err, count) {
          topic.postCount = count;
          deferred.resolve(topic);
        });
      }));
    })
  })
  .then(function(topicsWithPostCount) {
    topics = topicsWithPostCount;
    
    Post
    .find(query, null, { skip: skip, limit: limit, sort : { _id: -1 } })
    .populate('creator', 'profile')
    .populate('forum')
    .populate('topic')
    .populate('state')
    .populate('priority')
    .exec(function(err, posts) {
        var title = Site.options().post.name;
        if (options.forum)
          title = options.forum.name;
        if (options.topic)
          title += ' - '+options.topic.name;
        
        res.render('posts/list', { title: Site.options().post.name,
                                   forum: options.forum,
                                   topic: options.topic,
                                   posts: posts,
                                   postLimit: limit,// Number of posts per page
                                   postCount: postCount,// Number matching query
                                   postTotal: postTotal,// Total open posts
                                   page: page,
                                   topics: topics
        });
    });
  });
};
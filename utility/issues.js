var fs = require('fs');
var JiraClient = require('jira-connector');

var jira = new JiraClient( {
    host: 'issues.liferay.com',
    basic_auth: {
        base64: process.env.CREDENTIALS
    }
});

function getHTMLClassName(key) {
  return key.replace(/[^a-zA-Z0-9\-_]/g, "-")
}

function fetchIssueMetadata(issueKeys, start, issues, callback) {
  var sliceSize = 20;
  var end = start + sliceSize;

  console.log("Populating metadata for issues " + start + "-" + end);

  jira.search.search({
    jql: 'key in (' + issueKeys.splice(0, sliceSize).join(',') + ')',
    maxResults: 500,
    fields: [
      'key', 'fixVersions', 'customfield_12120', 'priority', 'watches',
      'customfield_10731', 'assignee', 'status', 'components', 'issuetype',
      'customfield_19120', 'customfield_20321', 'customfield_20527', 'summary',
      'duedate', 'comment', 'customfield_11523',
      'customfield_20720', 'customfield_10190'
    ],
    expand: [
      'changelog'
    ]
  }, function(error, response) {
    if (error) {
      console.log("Error = " + JSON.stringify(error));
    }
    else {
      issues = issues.concat(response.issues);

      if (issueKeys.length === 0) {
        fetchIssueWatchers(issues, callback);
      }
      else {
        fetchIssueMetadata(issueKeys, start + sliceSize, issues, callback);
      }
    }
 });
}

function fetchIssueWatchers(issues, callback) {
  var trimmedIssues = issues.map(trimIssue);
  var remaining = issues.length;

  console.log('Populating issue watchers');

  trimmedIssues.forEach(function(x) {
    if (x.watchCount > 0) {
      jira.issue.getWatchers({
        'issueKey': x.key
      }, function(error, response) {
        if (error) {
          console.log("Error = " + JSON.stringify(error));
        }
        else {
          x.watchers = response.watchers.map(function(y) {
            return { 'filterKey': getHTMLClassName(y.key), 'displayName': y.displayName };
          });

          if (--remaining == 0) {
            writeIssues(trimmedIssues, callback);
          }
        }
      });
    }
    else {
      x.watchers = [];

      if (--remaining == 0) {
        writeIssues(trimmedIssues, callback);
      }
    }
  });
}

function writeIssues(trimmedIssues, callback) {
  console.log("Writing issues to file");

  fs.writeFile("issues.json", JSON.stringify(
      trimmedIssues.sort(function (a, b) {
        return a.key > b.key ? 1 : a.key < b.key ? -1 : 0;
      })
  ), callback);
}

function fetchIssues(callback) {
  console.log("Fetching issues");

  var memberOfTS = [
   'membersOf(liferay-support-ts)',
   'membersOf(liferay-support-ts-us)',
   'support-hu'
  ].join(',');

  var resolvedStatuses = [
    '"Resolved"',
    '"Completed"',
    '"Solution Proposed"',
    '"Closed"',
    '"Audit"',
    '"On Hold"'
  ].join(',');

  jira.search.search({
    jql: `
      project = LPP AND status NOT IN (${resolvedStatuses}) AND
      (assignee IN (${memberOfTS}) OR watcher IN (${memberOfTS})) AND
      ("TS Solution Delivered" IN (EMPTY, No) OR type != Patch)
    `.split('\n').join(''),
    maxResults: 500,
    fields: [
      'key'
    ]
  }, function(error, response) {
    if (error) {
      console.log("Error = " + JSON.stringify(error));
    }
    else {
      var issueKeys = response.issues.map(function (issue) {
        return issue.key
      });

      fetchIssueMetadata(issueKeys, 0, [], callback);
    }
  });
}

function getBusinessHoursElapsed(startDate) {
  var businessHoursMilliseconds;
  var now = new Date();

  if ((startDate.getDate() === now.getDate()) &&
      (startDate.getMonth() === now.getMonth()) &&
      (startDate.getYear() ===now.getYear())) {

    return Math.round((now.getTime() - startDate.getTime()) / 3600000);
  }

  var startDateMidnight = new Date(startDate);

  startDateMidnight.setHours(24, 0, 0, 0);

  businessHoursMilliseconds = startDateMidnight.getTime() - startDate.getTime();

  var todayMidnight = new Date();

  todayMidnight.setHours(0, 0, 0, 0);

  businessHoursMilliseconds += new Date().getTime() - todayMidnight.getTime();

  var date = new Date(startDate.getTime() + 86400000);

  while (true) {
    if ((date.getDate() === now.getDate()) &&
        (date.getMonth() === now.getMonth()) &&
        (date.getYear() === now.getYear())) {

      break;
    }
    else if ((date.getDay() > 0) && (date.getDay() < 6)) {
      businessHoursMilliseconds += 86400000;
    }

    date = new Date(date.getTime() + 86400000);
  }

  return Math.round(businessHoursMilliseconds / 3600000);
}

function getHoursSinceAssignedDate(histories, assignee) {
  for (var i = histories.length - 1; i >= 0; i--) {
    var items = histories[i].items;

    for (var j = 0; j < items.length; j++) {
      if ((items[j].field === "assignee") &&
          (items[j].to === assignee)) {

        var assigneeDate = new Date(Date.parse(histories[i].created));

        return getBusinessHoursElapsed(assigneeDate);
      }
    }
  }
}

function getHoursSinceLastComment(comments, assignee) {
  for (var i = comments.length - 1; i >= 0; i--) {
    if (comments[i].author.key === assignee) {
      var commentDate = new Date(Date.parse(comments[i].created));

      return getBusinessHoursElapsed(commentDate);
    }
  }
}

function getHoursSinceLastPullRequest(histories) {
  for (var i = histories.length - 1; i >= 0; i--) {
    var items = histories[i].items;

    for (var j = 0; j < items.length; j++) {
      if (items[j].field === "LPP Git Pull Request") {
        var lastPullRequestDate = new Date(Date.parse(histories[i].created));

        return getBusinessHoursElapsed(lastPullRequestDate);
      }
    }
  }
}

function getHoursSinceStatusChange(histories, status) {
  for (var i = histories.length - 1; i >= 0; i--) {
    var items = histories[i].items;

    for (var j = 0; j < items.length; j++) {
      if ((items[j].field === "status") &&
          (items[j].toString === status)) {

        var statusChangeDate = new Date(Date.parse(histories[i].created));

        return getBusinessHoursElapsed(statusChangeDate);
      }
    }
  }
}

function getHoursSinceVerified(histories) {
  for (var i = histories.length - 1; i >= 0; i--) {
    var items = histories[i].items;

    for (var j = 0; j < items.length; j++) {
      if ((items[j].field === "Verified")) {

        var verifiedDate = new Date(Date.parse(histories[i].created));

        return getBusinessHoursElapsed(verifiedDate);
      }
    }
  }
}

function trimIssue(issue) {
  var trimmedIssue = {};

  var regionField = issue.fields.customfield_11523;

  trimmedIssue.key = issue.key;
  trimmedIssue.summary = issue.fields.summary;
  trimmedIssue.issueType = issue.fields.issuetype.name.toLowerCase().replace(/ /g, "-");
  trimmedIssue.priority = issue.fields.priority.name.toLowerCase();
  trimmedIssue.region = regionField ? regionField[0].value.toLowerCase() : null;
  trimmedIssue.lesaLink = issue.fields.customfield_10731;
  trimmedIssue.status = issue.fields.status.name;
  trimmedIssue.dueDate = issue.fields.duedate;
  trimmedIssue.watchCount = issue.fields.watches.watchCount;
  trimmedIssue.assignee = {
    'filterKey': getHTMLClassName(issue.fields.assignee.key),
    'displayName': issue.fields.assignee.displayName
  };

  if (issue.fields.components) {
    trimmedIssue.component = issue.fields.components.map(function(component) {
      return component.name;
    });
  }

  if (issue.fields.fixVersions) {
    trimmedIssue.fixVersions = issue.fields.fixVersions.map(function(fixVersion) {
      return fixVersion.name;
    });
  }

  if (issue.fields.customfield_20720) {
    trimmedIssue.verified = issue.fields.customfield_20720.value;
  }

  if (issue.fields.customfield_10190) {
    trimmedIssue.flagged = true;
  }

  if (issue.fields.customfield_12120) {
    trimmedIssue.issueFixedIn = issue.fields.customfield_12120.value;
  }

  if (issue.fields.customfield_19120) {
    trimmedIssue.difficulty = issue.fields.customfield_19120.value;
  }

  if (issue.fields.customfield_20321) {
    trimmedIssue.toDo = issue.fields.customfield_20321.value;
  }

  if (issue.fields.customfield_20527) {
    trimmedIssue.openDependencies = issue.fields.customfield_20527.map(function (openDependencies) {
      return openDependencies.value;
    });
  }

  if (trimmedIssue.dueDate && (new Date() > Date.parse(trimmedIssue.dueDate))) {
    trimmedIssue.isPastDueDate = true;
  }
  else {
    trimmedIssue.isPastDueDate = false;
  }

  trimmedIssue.hoursSinceAssigneeComment = getHoursSinceLastComment(
    issue.fields.comment.comments, issue.fields.assignee.key);

  trimmedIssue.hoursSinceAssigned = getHoursSinceAssignedDate(
    issue.changelog.histories, issue.fields.assignee.key);

  trimmedIssue.hoursSinceStatusChange = getHoursSinceStatusChange(
    issue.changelog.histories, trimmedIssue.status);

  trimmedIssue.hoursSinceVerified = getHoursSinceVerified(
    issue.changelog.histories);

  if (trimmedIssue.openDependencies && (trimmedIssue.openDependencies.indexOf("Code Review") > -1)) {
    trimmedIssue.hoursSincePullRequest = getHoursSinceLastPullRequest(
      issue.changelog.histories);
  }

  return trimmedIssue;
}

module.exports = {
  fetchIssues: fetchIssues
};
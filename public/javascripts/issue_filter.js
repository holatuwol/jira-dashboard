var assigneeCheckboxGroup;
var assignees = {"apac": [], "brazil": [], "eu": [], "india": [], "japan": [], "spain": [], "us": [], "no-region": []};
var clearFilters;
var dependencies = ['Backport Review', 'Code Review', 'CS/Customer', 'Internal Environment', 'LPS Escalation', 'Other LPP', 'Patcher Portal Automated Support Testing', 'Patcher Portal Hotfix Building', 'PTR', 'SME Request', 'Support Policy Question', 'Support Related Test at Product QA'];
var filters;
var grid;
var groupFilters = {};
var issueGrid;
var selectedFilters;

$(document).ready(function() {
  assigneeCheckboxGroup = $('#assignee-checkbox-group');
  clearFilters = $('#clear-filters');
  filters = $('#filters');
  grid = $('.grid');
  selectedFilters = $("#selected-filters");

  populateIssueGrid();

  issueGrid = grid.isotope({
    itemSelector: '.issue-element',
    masonry: {
      columnWidth: 75,
      gutter: 5
    }
  });

  filterByUrlParameters();

  clearFilters.click(function() {
    removeAllFilters();
  });

  filters.on('change', 'input[type=checkbox]', function(event) {
    updateFilter($(event.currentTarget));
  });

  filters.find('.accordion').click(function() {
    $(this).next().slideToggle('fast');

    $($(this).children()[0]).toggleClass('active');
  });

  selectedFilters.on('click', 'span', function(event) {
    var selectedFilterId = $(event.currentTarget).parent()[0].id;

    var filter = $("input[data-filter='" + selectedFilterId.substring(0, selectedFilterId.indexOf("-selected")) + "'");

    filter.prop('checked', false);

    updateFilter(filter);
  })
});

function addFilter(filter, filterName, filterGroup) {
  if (filterGroup && filterGroup.indexOf(filter) === -1) {
    filterGroup.push(filter);
  }

  selectedFilters.append(
    '<label id="' + filter + '-selected">' +
      filterName +
      '<span>x</span>' +
    '</label>'
  )
}

function buildAssigneeCheckboxes(regions, selectedAssignees) {
  var assigneeCheckboxes = new Set();
  var assigneesToUncheck = [];
  var regionAssignees = [];

  if (selectedAssignees) {
    assigneesToUncheck = selectedAssignees.slice();
  }

  $('div[filter-type=assignee]').empty();

  if (!regions || regions.length === 0) {
    regions = Object.keys(assignees);
  }

  for (var i = 0; i < regions.length; i++) {
    var region = regions[i].replace(/\./g, '');

    regionAssignees = regionAssignees.concat(assignees[region]);
  }

  regionAssignees.sort(function(a, b) {
    return a.localeCompare(b);
  });

  for (var j = 0; j < regionAssignees.length; j++) {
    var assignee = regionAssignees[j].split("|");

    var checked = false;

    if (selectedAssignees && (selectedAssignees.indexOf(assignee[0]) > -1)) {
      assigneesToUncheck.splice(assigneesToUncheck.indexOf(assignee[0]), 1);

      checked = true;
    }

    assigneeCheckboxes.add(
      '<label>' +
      '<input data-filter="' + assignee[0] + '" type="checkbox"' + (checked ? 'checked' : '') + '>' +
      assignee[1] +
      '</label>'
    );
  }

  if (assigneesToUncheck && (assigneesToUncheck.length > 0)) {
    for (var k = 0; k < assigneesToUncheck.length; k++) {
      selectedAssignees.splice(selectedAssignees.indexOf(assigneesToUncheck[k]), 1);

      removeFilter(assigneesToUncheck[k]);
    }
  }

  assigneeCheckboxGroup.append(Array.from(assigneeCheckboxes));
}

function filterByUrlParameters() {
  var urlFilterRegex = /[?&]+([^=&]+)=([^&]*)/gi;

  var match;
  var selectedFilters = [];

  while (match = urlFilterRegex.exec(location.href)) {
    var filterType = match[1];

    groupFilters[filterType] = match[2].split('+').map(function(filter) {
        filter = '.' + filter;

        selectedFilters.push(filter);

        return filter;
      });
  }

  buildAssigneeCheckboxes(groupFilters["region"], groupFilters["assignee"]);

  selectedFilters.forEach(function(filter) {
    var filterCheckbox = $("input[data-filter='" + filter + "'");

    filterCheckbox.prop('checked', true);

    var filterCheckboxParent = filterCheckbox.parent()[0];

    if (filterCheckboxParent) {
      addFilter(filter, filterCheckboxParent.innerText);
    }
  });

  updateIssueGrid();
}

function getFilterCombinations(arr) {
  return arr.reduce(function(a, b) {
    return a.map(function(x) {
      return b.map(function(y) {
        return x + y;
      })
    }).reduce(function(a, b) {
      return a.concat(b)
    },[])
  }, [[]])
}

function getIssueDependencies(issue) {
  var dependencyList = '';

  if (issue.openDependencies) {
    issue.openDependencies.forEach(function(dependency) {
      if (dependencies.indexOf(dependency) > -1) {
        dependencyList += (dependency.replace(/[\s\/]+/g, '-').toLowerCase() + ' ');
      }
    });
  }

  return dependencyList;
}

function getIssueUpdateStatus(issue) {
  var hours;

  if (issue.openDependencies && (issue.openDependencies.indexOf("Code Review") > -1) && (issue.hoursSincePullRequest !== undefined)) {
    hours = issue.hoursSincePullRequest;
  }
  else {
    var hoursSinceAssigneeComment = issue.hoursSinceAssigneeComment;
    var hoursSinceStatusChange = issue.hoursSinceStatusChange;
    var hoursSinceVerified = issue.hoursSinceVerified;

    if ((hoursSinceAssigneeComment === undefined) && (hoursSinceStatusChange === undefined) && (hoursSinceVerified === undefined)) {
      hours = issue.hoursSinceAssigned;
    }
    else {
      hours = Math.min(hoursSinceAssigneeComment || Infinity, hoursSinceStatusChange || Infinity, hoursSinceVerified || Infinity);
    }
  }

  if (hours < 24) {
    return "up-to-date";
  }
  else if (hours < 72) {
    return "update-soon";
  }
  else {
    return "needs-update";
  }
}

function populateIssueGrid() {
  issues.forEach(function(issue) {
    var issueRegion = issue.region || 'no-region';
    var issueDependencies = getIssueDependencies(issue);
    var issueUpdateStatus = getIssueUpdateStatus(issue);

    grid.append(
      '<div class="issue-element ' + (issue.status === "Blocked" ? 'blocked ' : '') + (issue.flagged ? 'flagged ' : '') + issueDependencies + issue.issueType + ' ' + issue.priority + ' ' + issueRegion + ' ' + issue.assignee + ' ' + issueUpdateStatus + '">' +
        '<div class="issue-update issue-' + issueUpdateStatus + '"/>' +
        '<div class="issue-details">' +
          '<a href="https://issues.liferay.com/browse/' + issue.key + '" target=”_blank”>' + issue.key + '</a>' +
          '<img class="issue-icon-priority" src="/images/' + issue.priority + '.svg" />' +
          '<img class="issue-icon" src="/images/' + issue.issueType + '.svg" />' +
          (issue.flagged ? '<img class="issue-icon-flag" src="/images/flag.svg" />' : '') +
          '<span class="issue-assignee">' + issue.assigneeDisplayName + ' </span> <br> <br>' +
          '<span class="issue-summary">' + issue.summary + '</span>' +
          (issue.openDependencies ? '<br> <br> <span class="issue-summary">' + issue.openDependencies.join(", ") + '</span>' : '') +
        '</div>' +
      '</div>'
    );

    var assignee = "." + issue.assignee + "|" + issue.assigneeDisplayName;

    if (assignees[issueRegion].indexOf(assignee) < 0) {
      assignees[issueRegion].push(assignee);
    }
  });
}

function removeAllFilters() {
  var selectedFilters = $('input:checkbox:checked');

  selectedFilters.each(function(key, filter) {
    $(filter).prop('checked', false);

    removeFilter($(filter).attr('data-filter'));
  });

  for (var key in groupFilters) {
    groupFilters[key] = [];
  }

  buildAssigneeCheckboxes();

  updateIssueGrid();

  updateWindowHistoryState();
}

function removeFilter(filter, filterGroup) {
  if (filterGroup) {
    var index = filterGroup.indexOf(filter);

    if (index !== -1) {
      filterGroup.splice(index, 1);
    }
  }

  $("#\\" + filter + "-selected").remove();
}

function updateIssueGrid() {
  var filters = [];

  for (var key in groupFilters) {
    var groupFilter = groupFilters[key];

    if (groupFilter.length) {
      filters.push(groupFilters[key]);
    }
  }

  if (filters.length) {
    clearFilters.show();
  }
  else {
    clearFilters.hide();
  }

  var filterCombinations = getFilterCombinations(filters);

  issueGrid.isotope({
    filter: filterCombinations.toString()
  });
}

function updateFilter(target) {
  var isChecked = target.prop('checked');
  var filter = target.attr('data-filter');
  var filterName = target.parent()[0].innerText;
  var filterType = target.parent().parent().attr('filter-type');

  var filterGroup = groupFilters[filterType];

  if (!filterGroup) {
    filterGroup = groupFilters[filterType] = [];
  }

  if (isChecked) {
    addFilter(filter, filterName, filterGroup);
  }
  else {
    removeFilter(filter, filterGroup);
  }

  if (filterType === "region") {
    buildAssigneeCheckboxes(filterGroup, groupFilters["assignee"]);
  }

  updateIssueGrid();

  updateWindowHistoryState();
}

function updateWindowHistoryState() {
  var urlParameters = [];

  for (var key in groupFilters) {
    var filters = groupFilters[key];

    if (filters.length) {
      urlParameters.push(key + "=" + filters.join('+').replace(/\./g, ''));
    }
  }

  window.history.replaceState(null, '', '?' + urlParameters.join('&'))
}
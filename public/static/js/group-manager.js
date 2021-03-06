/**
 * \file
 * \brief     Yoda Group Manager frontend.
 * \author    Chris Smeele
 * \copyright Copyright (c) 2015, 2017, Utrecht University
 * \license   GPLv3, see LICENSE
 */

"use strict";

$(function() {
    YodaPortal.extend('groupManager', {

        /**
         * \brief If the amount of visible groups is higher than or equal to this value,
         *        categories in the group list will be folded on page load.
         */
        CATEGORY_FOLD_THRESHOLD: 8,

        /// Group name prefixes that can be shown in the group manager.
        /// NB: To make group prefixes selectable in the group add dialog, the
        /// view phtml must be edited.
        GROUP_PREFIXES_RE:          /^(grp-|priv-|intake-|vault-|research-|datamanager-)/,

        /// A subset of GROUP_PREFIXES_RE that cannot be selected.
        GROUP_PREFIXES_RESERVED_RE: /^(priv-|vault-)/,

        /// The default prefix when adding a new group.
        GROUP_DEFAULT_PREFIX:       'research-',

        groupHierarchy: null, ///< A group hierarchy object. See YodaPortal.groupManager.load().
        groups:         null, ///< A list of group objects with member information. See YodaPortal.groupManager.load().

        isRodsAdmin: false, // This will be set in YodaPortal.groupManager.load().

        zone: null,
        userNameFull: null, ///< The username, including the zone name.

        /// A list of access / membership levels.
        accessLevels: ['reader', 'normal', 'manager'],

        /// Icon classes for access levels.
        accessIcons: {
            'reader':  'glyphicon-eye-open',
            'normal':  'glyphicon-user',
            'manager': 'glyphicon-tower',
        },

        /// Human-readable descriptions of access levels.
        /// These are used in title attrs of membership icons and on Change Role buttons.
        accessNames: {
            'reader':  'Member with read-only access',
            'normal':  'Regular member with write access',
            'manager': 'Group manager',
        },

        /// Get the name of an access level one lower than the current one for
        /// the given group.
        prevAccessLevel: function(current, groupName) {
            var prev = null;
            var currentI = this.accessLevels.indexOf(current);
            if (currentI)
                prev = this.accessLevels[currentI - 1];

            if (prev == 'reader' && !groupName.match(/^(research|intake)-/) && current == 'normal') {
                // The reader access level is only defined for research and intake groups.
                prev = null;
            }

            return prev;
        },

        /// Get the name of an access level one higher than the current one for
        /// the given group.
        nextAccessLevel: function(current, groupName) {
            var next = null;
            var currentI = this.accessLevels.indexOf(current);
            if (currentI + 1 < this.accessLevels.length)
                next = this.accessLevels[currentI + 1];
            return next;
        },

        // Functions that check membership / access status of the
        // client ('the user') {{{

        /**
         * \brief Check if the user is a member of the given group.
         *
         * \param groupName
         *
         * \return
         */
        isMemberOfGroup: function(groupName) {
            return (groupName in this.groups
                    && this.userNameFull in this.groups[groupName].members);
        },

        /**
         * \brief Check if the user is a manager in the given group.
         *
         * \param groupName
         *
         * \return
         */
        isManagerOfGroup: function(groupName) {
            return (this.isMemberOfGroup(groupName)
                    && (this.accessLevels.indexOf(this.groups[groupName]
                                                  .members[this.userNameFull].access)
                        >= this.accessLevels.indexOf('manager')))
        },

        /**
         * \brief Check if the user is allowed to manage the given group.
         *
         * If the user is of type rodsadmin, they do not need to be a
         * manager in the given group to manage it.
         *
         * \param groupName
         *
         * \return
         */
        canManageGroup: function(groupName) {
            return this.isRodsAdmin || this.isManagerOfGroup(groupName);
        },

        /**
         * \brief Try to check if the user is a manager in the given category.
         *
         * Returns false if the user does not have access to the given
         * category.
         *
         * rodsadmin type users are always a manager in any category.
         *
         * \param categoryName
         *
         * \return
         */
        isManagerInCategory: function(categoryName) {
            if (this.isRodsAdmin)
                return true;

            var that = this;
            try {
                var category = this.groupHierarchy[categoryName];
                return Object.keys(category).some(function(subcategoryName) {
                    return Object.keys(category[subcategoryName]).some(function(groupName) {
                        return that.isManagerOfGroup(groupName);
                    });
                });
            } catch (ex) {
                // The category is probably not visible to us.
                return false;
            }
        },

        /**
         * \brief Check whether the user is allowed to create the datamanager
         *        group in the given category.
         *
         * \param categoryName
         *
         * \return 
         */
        canCreateDatamanagerGroup: function(categoryName) {

            // Note: An existing datamanager group may not be visible to the
            //          user, even if they have priv-category-add.
            //          Is it user-friendly enough to allow them to attempt to
            //          create the group, and fail with an error message if it
            //          already exists?
            //          For now I assume it is.

            return (// if the category name can legally be translated to a group name ...
                    // XXX wip (regex taken from group name input element).
                       categoryName.match(/^([a-z0-9]|[a-z0-9][a-z0-9-]*[a-z0-9])$/)
                    // ... and the datamanager group does not yet exist (but see the note above).
                    && !(('datamanager-' + categoryName) in this.groups)
                    // ... and the user has priv-category-add or is rodsadmin.
                    && (this.isMemberOfGroup('priv-category-add') || this.isRodsAdmin));
        },

        // }}}

        /**
         * \brief Unfold the category belonging to the given group in the group list.
         *
         * \param groupName
         */
        unfoldToGroup: function(groupName) {
            var $groupList = $('#group-list');

            var $group = $groupList.find('.group[data-name="' + this.parent.escapeQuotes(groupName) + '"]');
            $group.parents('.category').children('a.name').removeClass('collapsed');
            $group.parents('.category').children('.category-ul').removeClass('hidden');
            $group.parents('.category').children('.category-ul').collapse('show');
        },

        updateGroupMemberCount: function(groupName) {
            var $userPanelTitle = $('.panel.users .panel-title');
            $userPanelTitle.text(
                $userPanelTitle.text().replace(
                    /(?:\s*\(\d+\))?$/,
                    ' (' + Object.keys(this.groups[groupName].members).length + ')'
                )
            );
        },

        /**
         * \brief Select the given group in the group list.
         *
         * \param groupName
         */
        selectGroup: function(groupName) {
            var group = this.groups[groupName];
            var userCanManage = this.canManageGroup(groupName);

            var $groupList = $('#group-list');
            var $group     = $groupList.find('.group[data-name="' + this.parent.escapeQuotes(groupName) + '"]');
            var $oldGroup  = $groupList.find('.active');

            if ($group.is($oldGroup))
                return;

            this.deselectGroup();

            this.unfoldToGroup(groupName);

            $oldGroup.removeClass('active');
            $group.addClass('active');
            YodaPortal.storage.session.set('selected-group', groupName);

            var that = this;

            var $groupPanel = $('.panel.groups');
            $groupPanel.find('.delete-button').toggleClass(
                'disabled',
                // Why do I need to boolify this?
                !!(!userCanManage || groupName.match(that.GROUP_PREFIXES_RESERVED_RE))
            );

            // The category of a datamanager group cannot be changed - the
            // category name is part of the group name.
            var canEditCategory = userCanManage && !groupName.match(/^datamanager-/);

            // Build the group properties panel {{{

            (function(){
                var $groupProperties = $('#group-properties');

                $groupProperties.find('.placeholder-text').addClass('hidden');
                $groupProperties.find('form').removeClass('hidden');

                $groupProperties.find('#f-group-update-category')
                    .select2('data', { id: group.category, text: group.category })
                    .select2('readonly', !canEditCategory);
                $groupProperties.find('#f-group-update-subcategory')
                    .select2('data', { id: group.subcategory, text: group.subcategory })
                    .select2('readonly', !userCanManage);
                $groupProperties.find('#f-group-update-name').siblings('.input-group-addon')
                    .html(function() {
                        var matches = groupName.match(that.GROUP_PREFIXES_RE, '');
                        return matches
                            ? matches[1]
                            : '&nbsp;&nbsp;';
                    });
                $groupProperties.find('#f-group-update-name')
                    .val(groupName.replace(that.GROUP_PREFIXES_RE, ''))
                    .prop('readonly', true)
                    .attr('title', 'Group names cannot be changed')
                    .attr('data-prefix', function() {
                        var matches = groupName.match(that.GROUP_PREFIXES_RE, '');
                        return matches
                            ? matches[1]
                            : '';
                    });
                $groupProperties.find('#f-group-update-description')
                    .val(group.description)
                    .prop('readonly', !userCanManage);
                $groupProperties.find('#f-group-update-submit')
                    .toggleClass('hidden', !userCanManage);
            })();

            // }}}
            // Build the user list panel {{{

            that.updateGroupMemberCount(groupName);

            (function(){
                var users = that.groups[groupName].members;

                var $userList = $('#user-list');
                $userList.find('.list-group-item.user').remove();

                Object.keys(users).slice().sort(function(a, b) {
                    function cmp(a, b) {
                        // For lack of a built-in '<=>' compare operator...
                        return (  a < b ? -1
                                : a > b ?  1
                                : 0);
                    }

                    // Sort based on access level first (more rights => higher in the list).
                    return (cmp(that.accessLevels.indexOf(users[b].access),
                                that.accessLevels.indexOf(users[a].access))
                            // ... then sort alphabetically on username.
                            || cmp(a, b));

                }).forEach(function(userName, i){
                    // Loop through the sorted user list and generate the #userList element.
                    var user = users[userName];

                    var $user = $('<a class="list-group-item user">');
                    $user.attr('id', 'user-' + i);
                    $user.addClass('user-access-' + user.access);
                    $user.attr('data-name', userName);
                    if (userName === that.userNameFull) {
                        $user.addClass('self');
                        if (!that.isRodsAdmin)
                            $user.addClass('disabled')
                                 .attr('title', 'You cannot change your own role or remove yourself from this group.');
                    }

                    var displayName = userName;
                    var nameAndZone = userName.split('#');
                    // Only display a user's zone if it differs
                    // from the client's zone.
                    if (nameAndZone[1] == that.zone)
                        displayName = nameAndZone[0];

                    $user.html('<i class="glyphicon '
                               + that.accessIcons[user.access]
                               + '" title="'
                               + that.accessNames[user.access]
                               + '"></i> '
                               + that.parent.escapeEntities(displayName));

                    $userList.append($user);
                });

                // Move the user creation item to the bottom of the list.
                var $userCreateItem = $userList.find('.item-user-create');
                $userCreateItem.appendTo($userList);
                $userCreateItem.toggleClass('hidden', !that.canManageGroup(groupName));

                $userList.find('#f-user-create-group').val(groupName);

                $userList.removeClass('hidden');

                var $userPanel = $('.panel.users');
                $userPanel.find('.panel-body:has(.placeholder-text)').addClass('hidden');

                // Fix bad bootstrap borders caused by hidden elements.
                $userPanel.find('.panel-heading').css({ borderBottom: 'none' });
                $userPanel.find('.panel-footer').css( { borderTop:    ''     });

                $userPanel.find('.create-button').removeClass('disabled');
                $userPanel.find('.update-button, .delete-button').addClass('disabled');
            })();

            // }}}
        },

        /**
         * \brief Deselects the selected group, if any.
         */
        deselectGroup: function() {
            this.deselectUser();

            var $groupPanel = $('.panel.groups');
            $groupPanel.find('.delete-button').addClass('disabled');

            var $groupList = $('#group-list');
            $groupList.find('.active').removeClass('active');

            var $groupProperties = $('#group-properties');
            $groupProperties.find('.placeholder-text').removeClass('hidden');
            $groupProperties.find('form').addClass('hidden');

            var $userPanel = $('.panel.users');

            var $panelTitle = $userPanel.find('.panel-title');
            $panelTitle.text($panelTitle.text().replace(/\s*\(\d+\)$/, ''));

            $userPanel.find('#user-list-search').val('');
            $userPanel.find('.panel-body:has(.placeholder-text)').removeClass('hidden');
            $userPanel.find('#user-list').addClass('hidden');

            // Fix bad bootstrap borders caused by hidden elements.
            $userPanel.find('.panel-heading').css({ borderBottom: ''               });
            $userPanel.find('.panel-footer').css( { borderTop:    '1px solid #ddd' });

            YodaPortal.storage.session.remove('selected-group');
        },

        /**
         * \brief Select the given user in the user list.
         *
         * \param groupName
         */
        selectUser: function(userName) {
            var $userList = $('#user-list');

            var $user    = $userList.find('.user[data-name="' + this.parent.escapeQuotes(userName) + '"]');
            var $oldUser = $userList.find('.active');

            if ($user.is($oldUser))
                return;

            this.deselectUser();

            $userList.find('.active').removeClass('active');
            $user.addClass('active');

            if (this.canManageGroup($('#group-list .active.group').attr('data-name'))) {
                var $userPanel = $('.panel.users');

                var $promoteButton = $userPanel.find('.promote-button');
                var $demoteButton  = $userPanel.find('.demote-button');

                var selectedGroupName = $($('#group-list .group.active')[0]).attr('data-name');
                var selectedGroup = this.groups[selectedGroupName];
                var selectedUser = selectedGroup.members[userName];

                var promoteTitle = 'Promote the selected user';
                var demoteTitle  = 'Demote the selected user';

                var prevAccess = this.prevAccessLevel(selectedUser.access, selectedGroupName);
                var nextAccess = this.nextAccessLevel(selectedUser.access, selectedGroupName);

                if (prevAccess) {
                    $demoteButton.find('i').addClass('glyphicon ' + this.accessIcons[prevAccess]);
                    $demoteButton.removeClass('disabled');
                    $demoteButton.attr('data-target-role', prevAccess);
                    demoteTitle += ' to ' + this.accessNames[prevAccess].toLowerCase();
                }
                if (nextAccess) {
                    $promoteButton.find('i').addClass('glyphicon ' + this.accessIcons[nextAccess]);
                    $promoteButton.removeClass('disabled');
                    $promoteButton.attr('data-target-role', nextAccess);
                    promoteTitle += ' to ' + this.accessNames[nextAccess].toLowerCase();
                }

                $promoteButton.attr('title', promoteTitle);
                $demoteButton .attr('title',  demoteTitle);
                $userPanel.find('.delete-button').removeClass('disabled');
            }
        },

        /**
         * \brief Deselects the selected user, if any.
         */
        deselectUser: function() {
            var $userPanel = $('.panel.users');
            var $userList  = $('#user-list');
            $userList.find('.active').removeClass('active');
            $userPanel.find('.update-button, .delete-button').addClass('disabled');
            var $promoteButton = $userPanel.find('.promote-button');
            var $demoteButton  = $userPanel.find('.demote-button');
            $promoteButton.attr('title', 'Promote the selected user');
            $demoteButton .attr('title', 'Demote the selected user');
            $promoteButton.removeAttr('data-target-role');
            $demoteButton .removeAttr('data-target-role');
            $promoteButton.find('i').removeClass();
            $demoteButton .find('i').removeClass();
        },

        /**
         * \brief Turn certain inputs into select2 inputs with autocompletion.
         */
        selectifyInputs: function(sel) {
            var that = this;

            // Category fields {{{

            $(sel).filter('.selectify-category').each(function() {
                var $el = $(this);

                $el.attr(
                    'placeholder',
                    (that.isMemberOfGroup('priv-category-add') || that.isRodsAdmin)
                        ? 'Select one or enter a new name'
                        : 'Select a category'
                );

                $el.select2({
                    ajax: {
                        quietMillis: 200,
                        url:      YodaPortal.baseUrl + 'group-manager/get-categories',
                        type:     'get',
                        dataType: 'json',
                        data: function (term, page) {
                            return { query: term };
                        },
                        results: function (categories) {
                            var results = [];
                            var query   = $el.data('select2').search.val();
                            var inputMatches = false;

                            // For legacy reasons we allow selecting existing categories with illegal names.
                            // New categories (where we show '(create)' in the dropdown) must adhere to the new rules:
                            // They must be valid as part of a group name -> only lowercase letters, numbers and hyphens.
                            //
                            // When we drop support for the old category name style this code can be updated to
                            // automatically lowercase user input (see the username input code for an example).

                            categories.forEach(function(category) {
                                if (query === category)
                                    inputMatches = true;

                                if (that.isManagerInCategory(category))
                                    results.push({
                                        id:   category,
                                        text: category,
                                    });
                                else if (inputMatches)
                                    // Only show a (disabled) category the user doesn't have access to
                                    // if they type its exact name.
                                    results.push({
                                        id:       category,
                                        text:     category,
                                        disabled: true,
                                    });
                            });
                            if (
                                  !inputMatches
                                && query.length
                                && (that.isMemberOfGroup('priv-category-add') || that.isRodsAdmin)
                            ) {
                                results.push({
                                    id:     query,
                                    text:   query,
                                    exists: false
                                });
                            }

                            return { results: results };
                        },
                    },
                    formatResult: function(result, $container, query, escaper) {
                        return escaper(result.text)
                            + (
                                'exists' in result && !result.exists
                                ? ' <span class="grey">(create)</span>'
                                : ''
                            );
                    },
                    initSelection: function($el, callback) {
                        callback({ id: $el.val(), text: $el.val() });
                    },
                }).on('open', function() {
                    $(this).select2('val', '');
                }).on('change', function() {
                    $($(this).attr('data-subcategory')).select2('val', '');

                    if (this.id === 'f-group-create-category') {
                        if (that.canCreateDatamanagerGroup(this.value))
                            $('#f-group-create-prefix-datamanager').removeClass('hidden');
                        else
                            $('#f-group-create-prefix-datamanager').addClass('hidden');

                        if ($('#f-group-create-name').attr('data-prefix') === 'datamanager-') {
                            // Reset the group name + prefix by pretending that
                            // the user clicked on the default prefix.
                            $('#f-group-create-prefix-div a[data-value="' + that.GROUP_DEFAULT_PREFIX + '"]').click();
                            $('#f-group-create-name').val('');
                        }
                    }
                });
            });

            // }}}
            // Subcategory fields {{{

            $(sel).filter('.selectify-subcategory').each(function() {
                var $el = $(this);

                $el.select2({
                    ajax: {
                        quietMillis: 200,
                        url:      YodaPortal.baseUrl + 'group-manager/get-subcategories',
                        type:     'get',
                        dataType: 'json',
                        data: function (term, page) {
                            return {
                                category: $($el.attr('data-category')).val(),
                                query: term
                            };
                        },
                        results: function (subcategories) {
                            var results = [];
                            var query   = $el.data('select2').search.val();
                            var inputMatches = false;

                            subcategories.forEach(function(subcategory) {
                                results.push({
                                    id:   subcategory,
                                    text: subcategory
                                });
                                if (query === subcategory)
                                    inputMatches = true;
                            });
                            if (!inputMatches && query.length)
                                results.push({
                                    id:   query,
                                    text: query,
                                    exists: false
                                });

                            return { results: results };
                        },
                    },
                    formatResult: function(result, $container, query, escaper) {
                        return escaper(result.text)
                            + (
                                'exists' in result && !result.exists
                                ? ' <span class="grey">(create)</span>'
                                : ''
                            );
                    },
                    initSelection: function($el, callback) {
                        callback({ id: $el.val(), text: $el.val() });
                    },
                }).on('open', function() {
                    $(this).select2('val', '');
                });
            });

            // }}}
            // Username fields {{{

            $(sel).filter('.selectify-user-name').each(function() {
                var $el = $(this);

                $el.select2({
                    allowClear:  true,
                    openOnEnter: false,
                    minimumInputLength: 3,
                    ajax: {
                        quietMillis: 400,
                        url:      YodaPortal.baseUrl + 'group-manager/get-users',
                        type:     'get',
                        dataType: 'json',
                        data: function (term, page) {
                            return {
                                query: term.toLowerCase()
                            };
                        },
                        results: function (users) {
                            var query   = $el.data('select2').search.val().toLowerCase();
                            var results = [];
                            var inputMatches = false;

                            users.forEach(function(userName) {
                                // Exclude users already in the group.
                                if (!(userName in that.groups[$($el.attr('data-group')).val()].members)) {
                                    var nameAndZone = userName.split('#');
                                    results.push({
                                        id:   userName,
                                        text: nameAndZone[1] === that.zone ? nameAndZone[0] : userName
                                    });
                                }
                                if (query === userName || query + '#' + that.zone === userName)
                                    inputMatches = true;
                            });

                            if (!inputMatches && query.length)
                                results.push({
                                    id:   query,
                                    text: query,
                                    exists: false
                                });

                            return { results: results };
                        },
                    },
                    formatResult: function(result, $container, query, escaper) {
                        return escaper(result.text)
                            + (
                                'exists' in result && !result.exists
                                ? ' <span class="grey">(create)</span>'
                                : ''
                            );
                    },
                    initSelection: function($el, callback) {
                        callback({ id: $el.val(), text: $el.val() });
                    },
                }).on('open', function() {
                    $(this).select2('val', '');
                });
            });

            // }}}
        },

        /**
         * \brief Group create / update form submission handler.
         *
         * `this` is assumed to be the groupManager object, not the form element
         * that was submitted.
         *
         * \param el the form element
         * \param e  a submit event
         */
        onSubmitGroupCreateOrUpdate: function(el, e) {
            e.preventDefault();

            var action =
                $(el).attr('id') === 'f-group-create'
                ? 'create' : 'update';

            $(el).find('input[type="submit"]')
                .addClass('disabled')
                .val(
                    action === 'create'
                    ? 'Adding group...'
                    : 'Updating...'
                );

            function resetSubmitButton() {
                $(el).find('input[type="submit"]')
                    .removeClass('disabled')
                    .val(
                        action === 'create'
                        ? 'Add group'
                        : 'Update'
                    );
            }

            var newProperties = {
                name:          $(el).find('#f-group-'+action+'-name'     ).attr('data-prefix')
                             + $(el).find('#f-group-'+action+'-name'     ).val(),
                description: $(el).find('#f-group-'+action+'-description').val(),
                category:    $(el).find('#f-group-'+action+'-category'   ).val(),
                subcategory: $(el).find('#f-group-'+action+'-subcategory').val(),
            };

            if (newProperties.category === '' || newProperties.subcategory === '') {
                alert('Please select a category and subcategory.');
                resetSubmitButton();
                return;
            } else if (
                // Validate input, in case HTML5 validation did not work.
                // Also needed for the select2 inputs.
                [newProperties.category, newProperties.subcategory, newProperties.description]
                    .some(function(item) {
                        return !item.match(/^[a-zA-Z0-9,.()_ -]*$/);
                    })
            ) {
                alert('The (sub)category name and group description fields may only contain letters a-z, numbers, spaces, comma\'s, periods, parentheses, underscores (_) and hyphens (-).');
                resetSubmitButton();
                return;
            }

            var postData = {
                group_name:        newProperties.name,
                group_description: newProperties.description,
                group_category:    newProperties.category,
                group_subcategory: newProperties.subcategory,
            };

            if (action === 'update') {
                var selectedGroup = this.groups[$($('#group-list .group.active')[0]).attr('data-name')];
                ['description', 'category', 'subcategory'].forEach(function(item) {
                    // Filter out fields that have not changed.
                    if (selectedGroup[item] === newProperties[item])
                        delete postData['group_' + item];
                });
            }

            $.ajax({
                url:      $(el).attr('action'),
                type:     'post',
                dataType: 'json',
                data:     postData
            }).done(function(result) {
                if ('status' in result)
                    console.log('Group '+action+' completed with status ' + result.status);
                if ('status' in result && result.status === 0) {
                    // OK! Make sure the newly added group is selected after reloading the page.
                    YodaPortal.storage.session.set('selected-group', postData.group_name);

                    // And give the user some feedback.
                    YodaPortal.storage.session.set('messages',
                        YodaPortal.storage.session.get('messages', []).concat({
                            type:    'success',
                            message: action === 'create'
                                     ? 'Created group ' + postData.group_name + '.'
                                     : 'Updated '       + postData.group_name + ' group properties.'
                        })
                    );

                    $(window).on('beforeunload', function() {
                        $(window).scrollTop(0);
                    });
                    window.location.reload(true);
                } else {
                    // Something went wrong.

                    resetSubmitButton();

                    if ('message' in result)
                        alert(result.message);
                    else
                        alert(
                              "Error: Could not "+action+" group due to an internal error.\n"
                            + "Please contact a Yoda administrator"
                        );
                }
            }).fail(function() {
                alert("Error: Could not create group due to an internal error.\nPlease contact a Yoda administrator");
            });
        },

        /**
         * \brief Handle a group delete button click event.
         */
        onClickGroupDelete: function(el) {
            var groupName = $('#group-list .group.active').attr('data-name');

            $('#group-list .group.active')
                .addClass('delete-pending disabled')
                .attr('title', 'Removal pending');
            this.deselectGroup();

            var that = this;

            $.ajax({
                url:      $(el).attr('data-action'),
                type:     'post',
                dataType: 'json',
                data: {
                    group_name: groupName,
                },
            }).done(function(result) {
                if ('status' in result)
                    console.log('Group remove completed with status ' + result.status);
                if ('status' in result && result.status === 0) {
                    // Give the user some feedback.
                    YodaPortal.storage.session.set('messages',
                        YodaPortal.storage.session.get('messages', []).concat({
                            type:    'success',
                            message: 'Removed group ' + groupName + '.'
                        })
                    );

                    $(window).on('beforeunload', function() {
                        $(window).scrollTop(0);
                    });
                    window.location.reload(true);
                } else {
                    // Something went wrong.

                    // Re-enable group list entry.
                    $('#group-list .group.delete-pending[data-name="' + that.parent.escapeQuotes(groupName) + '"]').removeClass('delete-pending disabled').attr('title', '');

                    if ('message' in result)
                        alert(result.message);
                    else
                        alert(
                              "Error: Could not remove the selected group due to an internal error.\n"
                            + "Please contact a Yoda administrator"
                        );
                }
            }).fail(function() {
                alert("Error: Could not remove the selected group due to an internal error.\nPlease contact a Yoda administrator");
            });
        },

        /**
         * \brief User add form submission handler.
         *
         * Adds a user to the selected group.
         *
         * `this` is assumed to be the groupManager object, not the form element
         * that was submitted.
         *
         * \param el the form element
         * \param e  a submit event
         */
        onSubmitUserCreate: function(el, e) {
            e.preventDefault();

            if ($(el).find('input[type="submit"]').hasClass('disabled'))
                return;

            var groupName = $(el).find('#f-user-create-group').val();
            var  userName = $(el).find('#f-user-create-name' ).val();

            if (!userName.match(/^([a-z.]+|[a-z0-9_.-]+@[a-z0-9_.-]+)(#[a-zA-Z0-9_-]+)?$/)) {
                alert('Please enter either an e-mail address or a name consisting only of lowercase chars and dots.');
                return;
            }

            $(el).find('input[type="submit"]').addClass('disabled').val('Adding...');

            var that = this;

            $.ajax({
                url:      $(el).attr('action'),
                type:     'post',
                dataType: 'json',
                data: {
                    group_name: groupName,
                     user_name: userName,
                },
            }).done(function(result) {
                if ('status' in result)
                    console.log('User add completed with status ' + result.status);
                if ('status' in result && result.status === 0) {
                    that.groups[groupName].members[userName] = {
                        // XXX
                        access: 'normal'
                    };

                    $(el).find('#f-user-create-name').select2('val', '');
                    $(el).addClass('hidden');
                    $(el).parents('.list-group-item').find('.user-create-text').removeClass('hidden');

                    that.deselectGroup();
                    that.selectGroup(groupName);
                    that.selectUser(userName);
                } else {
                    // Something went wrong. :(
                    if ('message' in result)
                        alert(result.message);
                    else
                        alert(
                              "Error: Could not add a user due to an internal error.\n"
                            + "Please contact a Yoda administrator"
                        );
                }
                $(el).find('input[type="submit"]').removeClass('disabled').val('Add');

            }).fail(function() {
                alert("Error: Could not add a user due to an internal error.\nPlease contact a Yoda administrator");
            });
        },

        /**
         * \brief Remove the confirmation step for removing users from groups.
         */
        removeUserDeleteConfirmationModal: function() {
            var that = this;
            $('.users.panel .delete-button').off('click').on('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                that.onClickUserDelete(this);
            });
        },

        /**
         * \brief Handle a change role button click event.
         *
         * `this` is assumed to be the groupManager object, not the form element
         * that was submitted.
         *
         * \param el
         * \param e
         */
        onClickUserUpdate: function(el, e) {
            var that = this;

            var groupName = $('#group-list .group.active').attr('data-name');
            var  userName = $('#user-list   .user.active').attr('data-name');

            $('#user-list .user.active')
                .addClass('update-pending disabled')
                .attr('title', 'Update pending');

            // Get the new role name from the button element before we deselect the user.
            var newRole = $(el).attr('data-target-role');

            this.deselectUser();

            $.ajax({
                url:      $(el).attr('data-action'),
                type:     'post',
                dataType: 'json',
                data: {
                    group_name: groupName,
                     user_name: userName,
                    new_role:   newRole
                },
            }).done(function(result) {
                if ('status' in result)
                    console.log('User update completed with status ' + result.status);
                if ('status' in result && result.status === 0) {
                    // Update user role.
                    that.groups[groupName].members[userName].access = newRole

                    // Force-regenerate the user list.
                    that.deselectGroup();
                    that.selectGroup(groupName);

                    // Give a visual hint that the user was updated.
                    $('#user-list .user[data-name="' + that.parent.escapeQuotes(userName) + '"]').addClass('blink-once');
                } else {
                    // Something went wrong. :(

                    $('#user-list .user.update-pending[data-name="' + that.parent.escapeQuotes(userName) + '"]')
                        .removeClass('update-pending disabled')
                        .attr('title', '');

                    if ('message' in result)
                        alert(result.message);
                    else
                        alert(
                              "Error: Could not change the role for the selected user due to an internal error.\n"
                            + "Please contact a Yoda administrator"
                        );
                }
            }).fail(function() {
                alert("Error: Could not change the role for the selected user due to an internal error.\nPlease contact a Yoda administrator");
            });
        },

        /**
         * \brief Handle a user delete button click event.
         *
         * `this` is assumed to be the groupManager object, not the form element
         * that was submitted.
         */
        onClickUserDelete: function(el) {
            if ($('#f-user-delete-no-confirm').prop('checked')) {
                $('#f-user-delete-no-confirm').prop('checked', false);
                YodaPortal.storage.session.set('confirm-user-delete', false);
                this.removeUserDeleteConfirmationModal();
            }

            var groupName = $('#group-list .group.active').attr('data-name');
            var  userName = $('#user-list   .user.active').attr('data-name');

            $('#user-list .user.active')
                .addClass('delete-pending disabled')
                .attr('title', 'Removal pending');
            this.deselectUser();

            var that = this;

            $.ajax({
                url:      $(el).attr('data-action'),
                type:     'post',
                dataType: 'json',
                data: {
                    group_name: groupName,
                     user_name: userName,
                },
            }).done(function(result) {
                if ('status' in result)
                    console.log('User remove completed with status ' + result.status);
                if ('status' in result && result.status === 0) {
                    delete that.groups[groupName].members[userName];

                    // Force-regenerate the user list.
                    that.deselectGroup();
                    that.selectGroup(groupName);
                } else {
                    // Something went wrong. :(

                    // Re-enable user list entry.
                    $('#user-list .user.delete-pending[data-name="' + that.parent.escapeQuotes(userName) + '"]').removeClass('delete-pending disabled').attr('title', '');

                    if ('message' in result)
                        alert(result.message);
                    else
                        alert(
                              "Error: Could not remove the selected user from the group due to an internal error.\n"
                            + "Please contact a Yoda administrator"
                        );
                }
            }).fail(function() {
                alert("Error: Could not remove the selected user from the group due to an internal error.\nPlease contact a Yoda administrator");
            });
        },

        /**
         * \brief Initialize the group manager module.
         *
         * The structure of the groupHierarchy parameter is as follows:
         *
         *     {
         *       'CATEGORY_NAME': {
         *         'SUBCATEGORY_NAME': {
         *           'GROUP_NAME': {
         *             'description': 'GROUP_DESCRIPTION',
         *             'members': {
         *               'USER_NAME': {
         *                 'access': (reader | normal | manager)
         *               }, ...
         *             }
         *           }, ...
         *         }, ...
         *       }, ...
         *     }
         *
         * \param groupHierarchy An object representing the category / group hierarchy visible to the user.
         *
         * \todo Generate the group list in JS just like the user list.
         */
        load: function(groupHierarchy, userType, userZone) {
            this.groupHierarchy = groupHierarchy;
            this.isRodsAdmin    = userType == 'rodsadmin';
            this.zone           = userZone;
            this.userNameFull   = YodaPortal.user.username + '#' + userZone;
            this.groups         = (function(hier) {
                // Create a flat group map based on the hierarchy object.
                var groups = { };
                for (var categoryName in hier)
                    for (var subcategoryName in hier[categoryName])
                        for (var groupName in hier[categoryName][subcategoryName])
                            groups[groupName] = {
                                category:    categoryName,
                                subcategory: subcategoryName,
                                name:        groupName,
                                description: hier[categoryName][subcategoryName][groupName].description,
                                members:     hier[categoryName][subcategoryName][groupName].members
                            };
                return groups;
            })(this.groupHierarchy);

            var that = this;
            var $groupList = $('#group-list');

            // Attach event handlers {{{
            // Generic {{{

            $(document).ajaxSend(function(e, request, settings) {
                // Append a CSRF token to all AJAX POST requests.
                if (settings.type === 'POST' && settings.data.length)
                    settings.data
                        += '&' + encodeURIComponent(YodaPortal.csrf.tokenName)
                         + '=' + encodeURIComponent(YodaPortal.csrf.tokenValue);
            });

            // }}}
            // Group list {{{

            $groupList.on('show.bs.collapse', function(e) {
                $(e.target).parent('.category').find('.triangle')
                    .removeClass('glyphicon-triangle-right')
                       .addClass('glyphicon-triangle-bottom');
            });
            $groupList.on('hide.bs.collapse', function(e) {
                $(e.target).parent('.category').find('.triangle')
                    .removeClass('glyphicon-triangle-bottom')
                       .addClass('glyphicon-triangle-right');
            });

            $groupList.on('click', 'a.group', function() {
                if ($(this).is($groupList.find('.active')))
                    that.deselectGroup();
                else
                    that.selectGroup($(this).attr('data-name'));
            });

            // Group list search.
            $('#group-list-search').on('keyup', function() {
                // TODO: Figure out how to correctly hide / show collapsible Bootstrap elements.
                return;

                /*
                $groupList  = $('#group-list');

                var $categories   = $groupList.find('.category');
                var $collapsibles = $categories.children('ul');
                var $groups       = $groupList.find('.group');

                var quotedVal = YodaPortal.escapeQuotes($(this).val());

                $collapsibles.css('transition', 'none');
                //$collapsibles.collapse('hide');
                $collapsibles.addClass('hidden');

                if (quotedVal.length) {
                    var $matches = $groups.filter('[data-name*="' + quotedVal + '"]');
                    $matches.each(function() { unfoldToGroup($(this).attr('data-name')); });
                } else {
                    //$categories.children('ul').collapse('hide');
                    //$categories.children('ul:not(.in)').addClass('collapse');
                    //$categories.children('a.name:not(.collapsed)').addClass('collapsed');

                    var $selected = $groups.filter('.active');
                    if ($selected.length)
                        that.unfoldToGroup($selected.attr('data-name'));
                }
                 */
            });

            // Group creation {{{

            $('#modal-group-create').on('show.bs.modal', function() {
                var $prefixDiv = $('#f-group-create-prefix-div');
                $prefixDiv.find('button .text').html(that.GROUP_DEFAULT_PREFIX + '&nbsp;');

                // Set up the group prefix field thingy by "clicking" on the default option.
                // (the event handler for that is below this one)
                $('#f-group-create-prefix-div a[data-value="' + that.GROUP_DEFAULT_PREFIX + '"]').click();

                $('#f-group-create-name')       .val('');
                $('#f-group-create-description').val('');

                // The 'datamanager-' prefix option becomes selectable once the
                // user selects a category that they are allowed to create the
                // datamanager group in.
                $('#f-group-create-prefix-datamanager').addClass('hidden');

                var $selectedGroup = $('#group-list .group.active');
                var  selectedGroupName;
                if (
                    $selectedGroup.length
                    && that.isManagerInCategory(
                        that.groups[(selectedGroupName
                                     = $($selectedGroup[0]).attr('data-name'))].category)
                ) {
                    // Fill in the (sub)category of the currently selected group.
                    $('#f-group-create-category')   .select2('val', that.groups[selectedGroupName].category);
                    $('#f-group-create-subcategory').select2('val', that.groups[selectedGroupName].subcategory);

                    if (that.canCreateDatamanagerGroup(that.groups[selectedGroupName].category))
                        $('#f-group-create-prefix-datamanager').removeClass('hidden');

                } else {
                    $('#f-group-create-category')   .select2('val', '');
                    $('#f-group-create-subcategory').select2('val', '');
                }
            });

            $('#modal-group-create #f-group-create-prefix-div a').on('click', function(e) {
                // Select new group prefix.
                var newPrefix = $(this).attr('data-value');

                $('#f-group-create-prefix-div button .text').html(newPrefix + '&nbsp;');
                $('#f-group-create-name').attr('data-prefix', newPrefix);

                if (newPrefix === 'datamanager-') {
                    // Autofill the group name - the user cannot customize the
                    // name of a datamanager group.
                    $('#f-group-create-name').val($('#f-group-create-category').val());
                    $('#f-group-create-name').prop('readonly', true);
                } else {
                    $('#f-group-create-name').prop('readonly', false);
                }

                e.preventDefault();
            });

            // Only rodsadmin can select the 'grp-' prefix.
            if (!this.isRodsAdmin)
                $('#f-group-create-prefix-grp').addClass('hidden');

            $('#modal-group-create').on('shown.bs.modal', function() {
                // Auto-focus group name in group add dialog.
                $('#f-group-create-name').focus();
            });

            // Group creation / update.
            $('#f-group-create, #f-group-update').on('submit', function(e) {
                that.onSubmitGroupCreateOrUpdate(this, e);
            });

            // Group removal.
            $('#modal-group-delete .confirm').on('click', function(e) {
                that.onClickGroupDelete($('.groups.panel .delete-button')[0]);
                $('#modal-group-delete').modal('hide');
            });

            $('#modal-group-delete').on('show.bs.modal', function() {
                var groupName = $('#group-list .group.active').attr('data-name');
                $(this).find('.group').text(groupName);
            });

            // }}}
            // }}}
            // User list {{{

            var $userList = $('#user-list');
            $userList.on('click', 'a.user:not(.disabled)', function() {
                if ($(this).is($userList.find('.active')))
                    that.deselectUser();
                else
                    that.selectUser($(this).attr('data-name'));
            });

            $userList.on('click', '.list-group-item:has(.user-create-text:not(.hidden))', function() {
                // Show the user add form.
                that.deselectUser();
                $(this).find('.user-create-text').addClass('hidden');
                $(this).find('form').removeClass('hidden');
                $(this).find('form').find('#f-user-create-name').select2('open');
            });

            $('#f-user-create-name').on('select2-close', function() {
                // Remove the new user name input on unfocus if nothing was entered.
                if ($(this).val().length === 0) {
                    $(this).parents('form').addClass('hidden');
                    $(this).parents('.list-group-item').find('.user-create-text').removeClass('hidden');
                }
            });

            // Adding users to groups.
            $('#f-user-create').on('submit', function(e) {
                that.onSubmitUserCreate(this, e);
            });

            // Changing user roles.
            $('.users.panel .update-button').on('click', function(e) {
                that.onClickUserUpdate(this, e);
            });

            // Remove users from groups.
            $('#modal-user-delete .confirm').on('click', function(e) {
                that.onClickUserDelete($('.users.panel .delete-button')[0]);
                $('#modal-user-delete').modal('hide');
            });

            $('#modal-user-delete').on('show.bs.modal', function() {
                var groupName = $('#group-list .group.active').attr('data-name');
                var  userName = $('#user-list  .user.active').attr('data-name');
                $(this).find('.group').text(groupName);
                $(this).find('.user').text(userName.split('#')[0]);
            });

            if (!YodaPortal.storage.session.get('confirm-user-delete', true))
                this.removeUserDeleteConfirmationModal();

            // User list search.
            $('#user-list-search').on('keyup', function() {
                var $users  = $('.panel.users .user');

                if ($(this).val().length) {
                    var quotedVal = YodaPortal.escapeQuotes($(this).val());
                    $users.filter('.filtered[data-name*="' + quotedVal + '"]').removeClass('filtered');
                    $users.filter(':not(.filtered):not([data-name*="' + quotedVal + '"])').addClass('filtered');
                } else {
                    $users.removeClass('filtered');
                }
            });

            // }}}
            // }}}

            this.selectifyInputs('.selectify-category, .selectify-subcategory, .selectify-user-name');

            if (this.isMemberOfGroup('priv-group-add') || this.isRodsAdmin) {
                var $groupPanel = $('.panel.groups');
                $groupPanel.find('.create-button').removeClass('disabled');
            }

            // Indicate which groups are managed by this user.
            for (var groupName in this.groups) {
                if (this.isManagerOfGroup(groupName)) {
                    $('#group-list .group[data-name="' + this.parent.escapeQuotes(groupName) + '"]').append(
                        '<span class="pull-right glyphicon glyphicon-tower" title="You manage this group"></span>'
                    );
                } else if (!this.isMemberOfGroup(groupName) && this.isRodsAdmin) {
                    $('#group-list .group[data-name="' + this.parent.escapeQuotes(groupName) + '"]').append(
                        '<span class="pull-right glyphicon glyphicon-wrench" title="You are not a member of this group, but you can manage it as an iRODS administrator."></span>'
                    );
                } else if (this.groups[groupName].members[this.userNameFull].access == 'reader') {
                    $('#group-list .group[data-name="' + this.parent.escapeQuotes(groupName) + '"]').append(
                        '<span class="pull-right glyphicon glyphicon-eye-open" title="You have read access to this group"></span>'
                    );
                }
            }

            var selectedGroup = YodaPortal.storage.session.get('selected-group');
            if (selectedGroup !== null && selectedGroup in this.groups) {
                // Automatically select the last selected group within this session (bound to this tab).
                this.selectGroup(selectedGroup);
            }

            if (Object.keys(this.groups).length < this.CATEGORY_FOLD_THRESHOLD) {
                // Unfold all categories containing non-priv groups if the user has access to less than
                // CATEGORY_FOLD_THRESHOLD groups.
                for (groupName in this.groups)
                    if (!groupName.match(/^priv-/))
                        this.unfoldToGroup(groupName);
            } else {
                // When the user can only access a single category, unfold it automatically.
                var $categoryEls = $('#group-list .category');
                if ($categoryEls.length === 1)
                    this.unfoldToGroup($categoryEls.find('.group').attr('data-name'));
            }
        },

    });
});

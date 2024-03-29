import React, { Component } from 'react';
import {
    ScrollView, 
    TouchableOpacity, 
    Text, 
    View,
    Image,
    RefreshControl,
    TextInput,
    ActivityIndicator,
    Alert
} from 'react-native';
import Spinner from 'react-native-loading-spinner-overlay';
import Loader from 'react-native-three-dots-loader'
import { 
    Feather,
    SimpleLineIcons,
    MaterialIcons,
    FontAwesome5,
    MaterialCommunityIcons,
    Ionicons
} from '@expo/vector-icons';
import BottomSheet from "react-native-gesture-bottom-sheet";

import { auth, db, _db } from '../firebase'

import fetch_date_time from '../api/GlobalTime'

import { CommentSection } from '../components/CommentSection'
import { EventScreenLoader } from '../components/SectionLoader' 

import SystemStyle from "../styles/SystemStyle";
import EditEventStyle from "../styles/EditEventStyle";
import EditProfileScreenStyle from "../styles/EditProfileScreenStyle";

import dateFormat from "../helper/DateFormat"
import { 
    _arrangeData,
    _getProfileImage,
    _getEventImage,
    _getUserData,
    _getAttendingCount,
    _checkEventAvailability,
    _checkUserAttendance
} from "../helper/EventLoad"
import { 
    _joinUserToEvent,
    _cancelReservation,
    _hasUserAdmitted,
    _deleteEvent,
    _notifyOnComment
} from '../helper/EventHelper';
import { _isFollowing } from "../helper/ProfileLoad";
import { _setFollowConnection } from '../helper/ProfileHelper';

class EventScreen extends Component {
    constructor() {
        super();
        this.state = {
            data: null,
            loading: true,
            user_data: null,
            
            raw_comment: null,
            comment_data: [],
            active_comment: false,
            is_active: false,
            is_extending: false,
            is_submitting: false,
            is_verifying: false,
            is_admitting: false,

            _extend: false,
            _limit: 5,
            _last: null,
        }
        this.onRefresh = this.onRefresh.bind(this)
        this._showOptions = this._showOptions.bind(this);

        this.comment_modal = React.createRef();
        this.comment_scroll = React.createRef();
    }
    componentDidMount() {
        this._startLoad();
    }
    componentDidUpdate(prevProps) {
        if(this.props.route.params.event_id !== prevProps.route.params.event_id ) {
            this.setState({loading: true});
            this._startLoad();
        }
    }
    _startLoad() {
        let event_id = this.props.route.params.event_id

        console.log('Opening Event with ID: ', event_id)

        if(event_id) {
            this._retrieveData(event_id)
        } else {
            this.props.navigation.goBack();
        }
    }
    async _retrieveData(event_id) {
        let uid = auth.currentUser.uid;

        let get_event_query = await db
            .collection('event')
            .doc(event_id)
            .get();
        
        let _data = get_event_query.data();

        if(!get_event_query.exists) {
            console.log('No data found for user: ', uid);
            this._invalidAccess();
            return;
        }

        _data.id = get_event_query.id;
        _data = await _arrangeData([_data], true); 

        _data = _data[0];

        if(!_data.is_open) {
            if(_data.owner != uid) {
                this._invalidAccess();
                return;
            } else {
                Alert.alert('Your event is hidden',
                    'This event is currently hidden to other bespeak users, change its status in edit event.');
            }
        }

        let current_count = await _getAttendingCount(event_id);

        if(!_data.is_owned) {
            this._addPopularity(event_id);
        }

        _data.is_attending = await _checkUserAttendance(_data.id);
        _data.is_limit = current_count >= _data.max
        _data.is_following = await _isFollowing(uid, _data.owner);
        
        console.log("Opened Event Data: ", _data)

        let _user_data_name = await _getUserData('_name', undefined)

        this._loadComments();

        this.setState({
            loading: false,
            data: _data,
            user_data: {
                name: _user_data_name,
            }
        });

        if(_data.has_ended) {
            Alert.alert('This event has ended', 'This event is now archived however interactions will remain enabled.')
        }
        
        this._loadImages(_data, uid);
    }

    async _addPopularity(event_id) {
        await db.collection('event')
            .doc(event_id)
            .update({
                _popularity: _db.FieldValue.increment(1)
            });
    }

    _invalidAccess() {
        Alert.alert('Content not available', 
            'The event you are trying to open was either removed or hidden by the owner.')
        this.props.navigation.goBack();
        return;
    }
    
    async _loadImages(item, uid) {
        // Load Images Synchronously 
        let user_image = await _getProfileImage(uid);

        item.event_image = item._banner ? item._banner
            : await _getEventImage(undefined, item.random_banner)
        item.owner_image = await _getProfileImage(item.owner);;

        this.setState({data: item, user_data: {...this.state.user_data, profile_image: user_image}});
    }

    async _retrieveComments(type_extend = false) {
        let event_id = this.props.route.params.event_id

        let get_comment_query = await db
            .collection('comment')
            .where('event_id', '==', event_id)
            .orderBy('server_time', 'desc')
        
        if(type_extend && this.state._last) {
            get_comment_query = get_comment_query
                .startAfter(this.state._last)
        }

        get_comment_query = await get_comment_query
            .limit(this.state._limit)
            .get()
            
        if(get_comment_query.empty) {
            console.log('No comments found for event: ', event_id);
            return {data: [], _last: this.state._last};
        }
        
        let _data = [];
        let _cleaned_data = [];

        get_comment_query.forEach((doc) => {
            _data.unshift({id: doc.id, ...doc.data()})
        })

        for(var i = 0; i < _data.length; i++) {
            let comment = _data[i]

            comment.owner_name = await _getUserData("_name", comment.owner) 

            if(!comment.owner_name) {
                comment.owner_name = 'Bespeak User';
            }

            comment.is_owned = comment.owner == auth.currentUser.uid;
            comment.server_time = await dateFormat(new Date(comment.server_time), "EEEE, MMMM d, yyyy h:mm aaa")

            _cleaned_data.push(comment);
        }
        
        let _last = get_comment_query.docs[get_comment_query.docs.length-1]; 

        return {data: _cleaned_data, last: _last};
    }

    _loadCommentImages(items, has_add = []) {
        // Load Images
        items?.forEach(async (item) => {
            item.owner_image = await _getProfileImage(item.owner);

            this.setState({comment_data: [...items, ...has_add]});
        })
    }
    
    async _loadComments() {
        let query_res = await this._retrieveComments();

        this.setState({
            comment_data: query_res.data,
            _last: query_res.last,
            _extend: query_res.data.length == this.state._limit
        });

        this._loadCommentImages(query_res.data)
    }

    async _extendLoadComments() {
        this.setState({
            _extend: false,
            is_extending: true
        });
        console.log('Extending Comments...')

        let query_res = await this._retrieveComments(true);

        let has_data = query_res.data.length == this.state._limit;
        
        let current_to_add = this.state.comment_data;

        this.setState({
            comment_data: [... query_res?.data, ... current_to_add],
            _last: query_res.last,
            _extend: has_data,
            is_extending: false
        });
        
        this._loadCommentImages(query_res?.data, current_to_add)
    }

    async _handleDelete(comment_data) {
        if(comment_data.owner == auth.currentUser.uid) {
            await db
                .collection('comment')
                .doc(comment_data.id)
                .delete()
                .catch(error => {
                    Alert.alert('Error!', error.message)
                    return
                }) 
                .then(async () => {
                    this.comment_modal.current.close()
                    
                    let current = this.state.comment_data;

                    let index = current?.indexOf(comment_data);
                    current.splice(index, 1)
                    this.setState({comment_data: current});
                });
            this.setState({ active_comment: false, is_active: false})
        }
    }
    
    async _handleSubmit() {
        let event = this.state.data;
        if(this.state.raw_comment) {
            this.setState({is_submitting: true});
            let comment_data = {
                owner: auth.currentUser.uid,
                event_id: event.id,
                content: this.state.raw_comment,
                server_time: await (await fetch_date_time()).epoch
            }

            await db
                .collection('comment')
                .add({
                    ...comment_data
                })
                .catch(error => {
                    Alert.alert('Error!', error.message)
                    return
                }) 
                .then(async (doc) => {
                    this.setState({raw_comment: null})
                    
                    let current = this.state.comment_data;
                    
                    comment_data.id = doc.id;
                    comment_data.owner_image = await _getProfileImage(comment_data.owner);
                    comment_data.owner_name = await _getUserData("_name", comment_data.owner)
                    comment_data.server_time = await dateFormat(new Date(comment_data.server_time), "EEEE, MMMM d, yyyy h:mm aaa")
                    comment_data.is_owned = true;

                    current?.push(comment_data);
                    this.setState({comment_data: current, is_submitting: false});
                    
                    console.log(this.comment_scroll.current);

                    _notifyOnComment(comment_data.event_id, event.owner);
                });
        }
    }

    doRefresh() {
        return new Promise((resolve) => {
          this._startLoad()
          setTimeout(resolve, 3000)
        });
    }
    async onRefresh() {
        console.log("Refreshing...")
        this.setState({'refreshing': true})
        await this.doRefresh().then(() => {
            this.setState({
                'refreshing': false
            })
            console.log("Refreshed.")
        })
    }
    async _handleFollow(uid) {
        let item = this.state.data;

        let result = await _setFollowConnection(undefined, uid,
            item.is_following ? 'unfollow' : 'follow');

        if(result) {
            this.setState({data: {
                ...item,
                is_following: !item.is_following
            }})
        }
    } 
    _openProfile(uid) {
        if(uid == auth.currentUser.uid) return;
        this.props.navigation.navigate('UserProfileScreen', {user_id: uid})
    }
    _showOptions(item) {
        this.setState({ active_comment: item, is_active: true })
        this.comment_modal.current.show();
    }

    async _handleAttend() {
        let item = this.state.data;
        let msg_content = false

        this.setState({is_verifying: true});

        switch(await _checkEventAvailability(item.id)) {
            case 103:
                msg_content = ['This event has ended', 'This event is now archived however interactions will remain enabled.'];
                break;
            case 102:
                msg_content = ['Event not available', 
                    'The event may have been deleted or hidden by the organizer.'];
                    Alert.alert(msg_content[0], msg_content[1]);
                    this.props.navigation.goBack();
                return;
            case 101:
                msg_content = ['No slots left', 
                    'The event has reached its registration limit.'];
                break;
            default:
        }

        if(await _checkUserAttendance(item.id)) {
            msg_content = ['You are already attending!', 'You are already registered on this event.'];
        }

        if(msg_content) {
            Alert.alert(msg_content[0], msg_content[1]);
            this.doRefresh();
            this.setState({is_verifying: false});
            return
        }

        this.setState({
            is_verifying: false,
            is_admitting: true
        });

        let ticket_id = await _joinUserToEvent(item.id);

        this.setState({is_admitting: false});

        if(ticket_id) {
            this.doRefresh();
            let nav = this.props.navigation;
            this.props.navigation.navigate('TicketScreen', 
                {ticket_id: ticket_id, navigation: nav})
        }
    }

    async _handleCancelation() {
        this.setState({is_verifying: true});
        let item = this.state.data;

        if(!await _hasUserAdmitted(item.id)) {
            await _cancelReservation(item.id);
            this.doRefresh();
        } else {
            Alert.alert('Not allowed', 
                'You cannot cancel your reservation to this event anymore.',
                [{text: 'Okay'}]);
        }
        this.setState({is_verifying: false});
    }

    async _handleEventDelete() {
        let item = this.state.data;

        this.setState({is_admitting: true});
        await _deleteEvent(item.id);
        this.setState({is_admitting: false});

        this.props.navigation.goBack();
    }

    async _reOpenTicket() {
        let uid = auth.currentUser.uid;
        let item = this.state.data;
        let ticket_id = null;

        console.log('Getting ticket of user: ', uid, ' event: ', item.id);

        let ticket_query = await db.collection('ticket')
            .where('event_id', '==', item.id)
            .where('owner', '==', uid)
            .get();

        ticket_query.forEach((doc) => {
            ticket_id = doc.id;
        })

        if(ticket_id) {
            this.doRefresh();
            let nav = this.props.navigation;
            this.props.navigation.navigate('TicketScreen', 
                {ticket_id: ticket_id, navigation: nav})
        }
    }

    render() {
        let item = this.state.data;
        let comment_content = Object.values(this.state.comment_data);
        let active_comment = this.state.active_comment;

        if(this.state.loading) 
            return (
                <EventScreenLoader/>
                /*
                <View style={SystemStyle.TabContainer}>
                    <ActivityIndicator size={'large'} color="grey"/> 
                </View>*/
            )

        return (
            <ScrollView
                refreshControl={
                    <RefreshControl
                        refreshing={this.state.refreshing}
                        onRefresh={this.onRefresh}
                        colors={["gray", "orange"]}/>
                }>

                {
                    (this.state.is_verifying || this.state.is_admitting) && 
                    <Spinner visible={true} textContent={this.state.is_verifying ?
                        'Verifying your request...' : 'Please wait...'}
                            textStyle={SystemStyle.defaultLoader}
                            animation = 'fade'
                            overlayColor = 'rgba(0, 0, 0, 0.50)'/>
                }
                <View style={EditEventStyle.EventContainer}>
                    <View style={EditEventStyle.ImgContainer}>
                        <Image style={EditEventStyle.ImgContainer}
                            source={ item.event_image }/>
                    </View>
                    <View style={EditEventStyle.EventContainer}>
                        <View style={EditEventStyle.TitleAndButtonRow}>
                        <Text style={EditEventStyle.EventTitle}>{ item.name }</Text>
                            { item.owner == auth.currentUser.uid && !item.is_overlap &&
                                <TouchableOpacity style={SystemStyle.FollowOrgBtn}
                                    onPress={() => this.props.navigation.navigate('EditEventScreen', 
                                    {event_id: item.id, 
                                    _done: this.onRefresh})}>
                                        <Text style={SystemStyle.FollowOrgTextBtn}>Edit Event</Text>
                                </TouchableOpacity>
                            }
                        </View>
                        <View style={SystemStyle.OrganizerTab}>
                            <TouchableOpacity style={SystemStyle.OrganizerInfo}
                                onPress={() => this._openProfile(item.owner) }>
                                    <View style={SystemStyle.OrganizerImgContainer}>
                                        <Image style={SystemStyle.OrganizerImg}
                                            source={ item.owner_image }/>
                                    </View>
                                    <View style={SystemStyle.OrgCardContainer}>
                                        <Text style={SystemStyle.OrganizerNameButBlack}>{ item.owner_name }</Text>
                                    </View>
                            </TouchableOpacity>

                            { item.owner != auth.currentUser.uid &&
                                <TouchableOpacity style={
                                    !item.is_following ? 
                                        SystemStyle.FollowOrgBtn : SystemStyle.FollowingOrgBtn}
                                    onPress={() => this._handleFollow(item.owner)}>
                                        <Text style={SystemStyle.FollowOrgTextBtn}>{
                                            !item.is_following ? 'Follow' : 'Unfollow'
                                        }</Text>
                                </TouchableOpacity>
                            }
                        </View>
                        <View style={SystemStyle.LowerSection}>
                            <Feather name="calendar" size={24} color="black" />
                            <Text style={SystemStyle.EventSchedule}>{ item.sched }</Text>
                        </View>
                        <View style={SystemStyle.LowerSection}>
                            <SimpleLineIcons name="location-pin" size={24} color="black" />
                            <Text style={SystemStyle.EventPlace}>{ item.location }</Text>
                        </View>
                    </View>
                </View>
                <View>
                    <Text style={SystemStyle.LineBreak}></Text>
                </View>
                <View style={SystemStyle.Container}>

                    <Text style={SystemStyle.EventAboutTitle}>About</Text>
                    <Text style={SystemStyle.EventTextInfo}>
                        { item.desc }
                    </Text>
                    
                    <Text style={SystemStyle.EventAddInfoTitle}>
                        Additional Information</Text>
                    <Text style={SystemStyle.EventTextInfo}>
                        { item.info } 
                    </Text>
                    <View style={SystemStyle.BreakLineContainer}>
                        <Text style={SystemStyle.BreakLine}></Text>
                        <Text style={SystemStyle.BreakLineComment}>Comments</Text>
                    </View>
                    
                    
                    { comment_content.length > 0 && (
                            <>
                                { this.state.is_extending &&
                                    <View style={SystemStyle.Center}>  
                                        <Loader key = {this.state.is_extending}/>
                                    </View>
                                }
                                { this.state._extend && 
                                    <View style={SystemStyle.Center}>  
                                        <TouchableOpacity style={SystemStyle.LoadBtn}
                                            onPress={() => this._extendLoadComments()}>
                                                <Text style={SystemStyle.LoadText}> {
                                                    'Load more comments...'
                                                } </Text>
                                        </TouchableOpacity>
                                    </View>    
                                }
                                <ScrollView>
                                    { comment_content.map((item)=> 
                                        <CommentSection data = {item}
                                            key = {item.id}
                                            navigation = {this.props.navigation}
                                            _triggerOption = {this._showOptions}/>
                                    )}
                                </ScrollView>
                            </>
                        )
                    }

                    <View style={SystemStyle.BespeakerCommentContainer}>
                        <View style={SystemStyle.BespeakerImgContainer}>
                            <Image style={SystemStyle.BespeakerImg}
                                source={ this.state.user_data.profile_image }/>
                        </View>
                        <View style={SystemStyle.BespeakerContainer}>
                            <Text style={SystemStyle.BespeakerName}> { this.state.user_data.name } </Text>
                            <View style={SystemStyle.BespeakerInput}>
                                <TextInput style={SystemStyle.MyCommentInput}
                                    autoCorrect = {false}
                                    value = {this.state.raw_comment}
                                    selectionColor={'#eb9834'}
                                    multiline={true}
                                    placeholder='Write a comment..'
                                    maxLength={150}
                                    onChangeText={text => {
                                        this.setState({raw_comment: text});
                                    }}/>

                                <View style={SystemStyle.SendComment}>
                                    { this.state.is_submitting ? (
                                            <ActivityIndicator size={25} color="orange"/> 
                                        ) : (
                                            <TouchableOpacity
                                                onPress = {() => this._handleSubmit()}>
                                                    <Ionicons name="send" size={24} 
                                                        color={ this.state.raw_comment ? "black" : "#5b5c5a"}/>
                                            </TouchableOpacity>
                                        )
                                    }
                                </View>
                                
                            </View>
                        </View>
                    </View>       
                </View>
                <View style={SystemStyle.AttendingContainer}>
                    {item.owner == auth.currentUser.uid ? (
                        <>
                            <TouchableOpacity style={SystemStyle.ViewAttendeeBtn}
                                onPress={() => 
                                    this.props.navigation.navigate('ParticipantListScreen', {
                                        event_id: item.id
                                    }) }>
                                    <MaterialIcons name="people-outline" size={20} color="#fff" />
                                    <Text style={SystemStyle.ViewAttendeeTextBtn}>View Attendees</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={EditProfileScreenStyle.DeleteBtn}
                                onPress = {() => Alert.alert('Delete Event', 'Are you sure? ' + 
                                    'This cannot be retrieved anymore once done. '  + 
                                    'Those who have registered to the event will receive a notification about ' + 
                                    'your decision to cancel the event.', 
                                [ {text: 'Cancel', style:'cancel'},
                                    {text: 'Yes', onPress: () => this._handleEventDelete()}])}>
                                <Text style={EditProfileScreenStyle.DeleteTextBtn}> Delete Event</Text>
                            </TouchableOpacity>
                        </>
                    ) : (
                        <>
                            { item.has_ended ? (
                                <View style={SystemStyle.EventEndedBtnButGray}>
                                    <MaterialIcons name="event-busy" size={20} color="#5b5c5a" />
                                    <Text style={SystemStyle.EventEndedTextForGrayBtn}>Event has ended</Text>
                                </View>
                            ) : (
                                <>
                                { item.is_attending ? (
                                    <>
                                        <TouchableOpacity style={SystemStyle.AttendingBtn}
                                            onPress = { () => this._reOpenTicket() }>
                                                <MaterialCommunityIcons name="ticket-confirmation" size={20} color="#fff" />
                                                <Text style={SystemStyle.ReOpenTicketForOrangeBtn}>Attending — View Ticket</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity style={EditProfileScreenStyle.DeleteBtn}
                                            onPress = {() => Alert.alert('Cancel Reservation', 'Are you sure? ' + 
                                            'This will delete and invalidate your ticket.', 
                                            [ {text: 'Cancel', style:'cancel'},
                                                {text: 'Yes', onPress: () => this._handleCancelation()}])}>
                                                    <Text style={EditProfileScreenStyle.DeleteTextBtn}> Cancel Reservation</Text>
                                        </TouchableOpacity>
                                    </>
                                ) : (
                                    <>
                                        { item.is_limit ? (
                                            <View style={SystemStyle.EventEndedBtnButGray}>
                                                <MaterialIcons name="emoji-people" size={20} color="#5b5c5a" />
                                                <Text style={SystemStyle.EventEndedTextForGrayBtn}>No remaining slots left</Text>
                                            </View>
                                        ) : item.is_overlap ? (
                                            <TouchableOpacity style={SystemStyle.AttendingBtn}
                                                onPress={() => this._handleAttend()}>
                                                    <MaterialCommunityIcons name="human-handsup" size={20} color="#fff" />
                                                    <Text style={SystemStyle.AttendingTextBtn}>Happening now — Register</Text>
                                            </TouchableOpacity>
                                        ) : (
                                            <TouchableOpacity style={SystemStyle.AttendingBtn}
                                                onPress={() => this._handleAttend()}>
                                                    <Text style={SystemStyle.AttendingTextBtn}>I want to attend</Text>
                                            </TouchableOpacity>
                                        )}
                                    </>
                                )}
                                </>
                                
                            )}
                        </>
                    )}
                </View>
                
                <BottomSheet hasDraggableIcon
                    ref={this.comment_modal}
                    height={90}
                    radius={35}>
                        <View style={SystemStyle.CommentInfoView}>
                            <View style={SystemStyle.DeleteModalView}>
                                { active_comment.is_owned &&
                                    <TouchableOpacity style={SystemStyle.Icon}
                                        onPress={() => this._handleDelete(active_comment) }>
                                            <MaterialIcons name="delete-outline" size={24} color="black" />
                                            <Text style={SystemStyle.DeleteTextBtn}>Delete</Text>
                                    </TouchableOpacity>
                                }
                                <View style={SystemStyle.CommentDateInfo}>
                                    <FontAwesome5 name="clock" size={24} color="black" style={SystemStyle.Icon}/>
                                    <Text style={SystemStyle.CommentDate}>{ active_comment.server_time }</Text>
                                </View>
                            </View>
                        </View>
                </BottomSheet>
            </ScrollView>
        );
    }
}

export default { EventScreen };

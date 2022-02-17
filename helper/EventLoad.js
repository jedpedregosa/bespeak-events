import { auth, db, storage } from '../firebase'
import dateFormat from '../helper/DateFormat';

async function _arrangeData(events_data, mod = false) {
    //console.log('Arranging: ', events_data)
    let arranged_data = [];

    for(var i = 0; i < events_data.length; i++) {
        let item = events_data[i]
        //console.log('Arranging: ', item)

        // Check if own event.
        item.is_owned = item.owner == auth.currentUser.uid

        item.owner_image = await _getOrganizerImage(item.owner)

        item.owner_name = await _getOrganizerName(item.owner);
        item.event_image = await _getEventImage(item.id);

        let raw_sched = parseInt(item.schedule);
        let raw_posted = parseInt(item.server_time);

        let sched = await dateFormat(new Date(raw_sched), 
            mod ? "EEEE, MMMM d, yyyy ∘ Starts at h:mm aaa" : "EEEE, MMMM d, yyyy ∘ h:mm aaa");
        let posted = await dateFormat(new Date(raw_posted), "MMMM d, yyyy");
        
        item.sched = sched;
        item.date_posted = posted;

        arranged_data.push(item)
    }
    return arranged_data;
}

async function _getOrganizerImage(user_id) {
    let user_image = false;
    await storage.ref(`/users/${user_id}/profile`)
        .getDownloadURL()
        .then((url) => { 
            user_image = url
            //console.log("Loaded Event Image for ", user_image, ": ", url)
        }).catch((error) => {
            if(error.code != 'storage/object-not-found') {
                console.log("Error occured: ", error.message)
                Alert.alert('Error!', error.message)
            }
        })

    if(user_image) {
        return {uri: user_image};
    }
    return require('../assets/img/blank-profile.png');
}

async function _getEventImage(event_id) {
    let event_image = false;
    await storage.ref(`/event/${event_id}/banner`)
        .getDownloadURL()
        .then((url) => { 
            event_image = url
            console.log("Loaded Event Image for ", event_id, ": ", url)
        }).catch((error) => {
            if(error.code != 'storage/object-not-found') {
            console.log("Error occured: ", error.message)
            Alert.alert('Error!', error.message)
            }
        })

    if(event_image) {
        return {uri: event_image};
    }
    return require('../assets/img/blank-cover.png');
}
// #TODO: OPTIMIZE
async function _getOrganizerName(uid) {
    console.log('Getting Organizer Name for ID: ' + uid);

    const user_info = db.collection("user_info")
    const query = user_info.doc(uid)
    const snapshot = await query.get()

    if(snapshot.empty) {
        console.log('No data found for user: ', uid);
        return "Bespeak User";
    } 

    var raw_data = snapshot.data()
    var organizer_name = ''

    if(raw_data.user_type == "INDIV") {
        organizer_name = raw_data.f_name 
            + ' ' + raw_data.l_name;
    } else {
        organizer_name = raw_data.org_name
    }

    return organizer_name;
}

async function _getOrganizerLocation(uid) {
    console.log('Getting Organizer Loc for ID: ' + uid);

    const user_info = db.collection("user_info")
    const query = user_info.doc(uid)
    const snapshot = await query.get()

    if(snapshot.empty) {
        console.log('No data found for user: ', uid);
        return;
    } 

    var raw_data = snapshot.data()
    return raw_data.location;
}

export {
    _arrangeData,
}
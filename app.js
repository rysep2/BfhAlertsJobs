var firebase = require('firebase-admin');
var request = require('request');
var notifier = require('mail-notifier');
var cron = require('cron');

// Your Firebase Cloud Messaging Server API key
var API_KEY = "AAAA7ZMOSOY:APA91bHmhn-Ys674dH6VF1FKeKNiH0K1exjdyx-9xZmEaSgPN2GzZCbnbms77_sm6xL9KxCLMzxNBxE0VHuXPRlpY_Ge2-ViIppguqDR2cR9Mbt-VmVSB9P8ZlkintMRoz3TyLrJXtW0MOEG3OzBR5NC4mceoKi4Bw";

// Firebase als Admin mit dem initialisieren mit dem Default Login (nur auf Google-Plattformen möglich)
firebase.initializeApp({
  credential: firebase.credential.applicationDefault(),
  databaseURL: "https://bfhalerts.firebaseio.com/"
});
ref = firebase.database().ref();

var alertsRef = ref.child('alerts');
var phoneNumbersRef = ref.child('phone_numbers');

// Listener, der auf, in Firebase gespeicherte Alarme reagiert
function listenForNotificationRequests() {
  alertsRef.limitToLast(1).on('child_added', function(requestSnapshot) {
	var requestKey = requestSnapshot.key;
    var request = requestSnapshot.val();
	
    console.log("Key: " + requestKey);
    console.log("Alert already sent: " + request.notificationSent);
	
	if (request.notificationSent == false) {
		sendNotificationToUser(
		  request.alertType, 
		  request.startTime,
		  requestKey,
		  function() {				  
			console.log("Successfully sent");
			
			var alertRef = alertsRef.child(requestKey);
			alertRef.update({
				notificationSent: true
			});		
			console.log("Entry updated");		
		  }
		);
	}
  }, function(error) {
    console.error(error);
  });
};

// Versenden der Data-Notification (Alarm)
function sendNotificationToUser(alertType, startTime, key, onSuccess) {
  request({
    url: 'https://fcm.googleapis.com/fcm/send',
    method: 'POST',
    headers: {
      'Content-Type' :' application/json',
      'Authorization': 'key=' + API_KEY
    },
    body: JSON.stringify({
	  data: {
	    id: key,
		starttime: startTime,
		alerttype: alertType
      },
      to : '/topics/alerttype_' + alertType
    })
  }, function(error, response, body) {
    if (error) { console.error(error); }
    else if (response.statusCode >= 400) { 
      console.error('HTTP Error: ' + response.statusCode + ' - ' + response.statusMessage); 
    }
    else {
      onSuccess();
    }
  });
}

// Listener für neue Alarme starten
listenForNotificationRequests();

// Verbindung zur BFH-Mailbox aufbauen
var mailListener = new notifier({
  username: "rysep2@bfh.ch",
  password: "Ochrasy8$",
  host: "imap.bfh.ch",
  port: 993, // IMAP port 
  tls: true // Sichere Verbindung verwenden
});

function listenForMails() {
	
	mailListener.on("mail", function(mail){
			
		if (mail.html != "" && mail.html != undefined) {				
			
			if (mail.headers.from = "<BFH-VoiceMail-noReply@bfh.ch>") {
			
				var arrInfo = mail.html.split("<tr>");
				var date = arrInfo[1].substr(31, 10);
				var time = arrInfo[2].substr(18, 8);
				var caller = arrInfo[3].substr(21, 5);
				var recipient = arrInfo[4].replace( /(^.*\(|\).*$)/g, '' );
				
				console.log(recipient);
				
				// Die Nummer des Monats wird normal mitgegeben, Javascript braucht in aber von 0-11.
				var month = parseInt(date.substr(3, 2)) - 1;

				// Datumsobjekt erstellen um es in Milisekunden umwandeln zu können.
				var startdate = new Date(date.substr(6, 4), month, date.substr(0, 2), time.substr(0, 2),
											time.substr(3, 2), time.substr(6, 2), 0);
				
				// Name von Anrufer erhalten wenn in DB sonst Anonym
				phoneNumbersRef.child(caller).once("value", function(callerSnapshot) {
					
					// Name anhand von Telefonnummer erhalten falls in DB vorhanden
					var name = "Anonym";
					if (callerSnapshot.hasChild("name")) {				
						name = callerSnapshot.val().name;
						console.log(name);				
					}
					
					// Neuer Alarm in Firebase erstellen
					var newAlertRef = alertsRef.push();
					newAlertRef.set({
					  alertType: parseInt("1", 10),
					  startTime: startdate.getTime(),
					  user: name,
					  notificationSent: false
					});
					
					var messagesRef = newAlertRef.child('messages');
					var newMessageRef = messagesRef.push();
					newMessageRef.set({
					  message: "Neuer Alarm gestartet",
					  time: startdate.getTime(),
					  user: name
					});			
				});
				
				console.log("Alert call registered");
			}
		}
	});
	
	mailListener.start();
	console.log("MailListener gestartet ");

}

//Listener für neue Mails starten
listenForMails();

//Alle 30 Sekunden Neustart versuchen wenn die Verbindung unterbrochen ist.
mailListener.on("error", function(error){
  console.log("imapError", error);
  setTimeout(function(){listenForMails();}, 30000)
});

var cronJob = cron.job("00 00 01 * * *", function(){
	var archivedAlertsRef = ref.child('archived_alerts');
			
	// Momentaner Tag minus einem Tag
	var yesterday = new Date(); // Heute
	yesterday.setDate(yesterday.getDate() - 1); // Gestern
	yesterday.setHours(0,0,0,0); //Zeit auf 0 setzen

	alertsRef.once("value", function(totalSnapshot) {

		totalSnapshot.forEach(function(snapshot) {
			var request = snapshot.val();
			
			var startDatum = new Date(request.startTime);
			startDatum.setHours(0,0,0,0); //Zeit auf 0 setzen
			
			if (startDatum <= yesterday) {
				// Archivierter Alarm in Firebase speichern
				var newAlertRef = archivedAlertsRef.push();
				newAlertRef.set({
				  alertType: request.alertType,
				  startTime: request.startTime,
				  user: request.user,
				  notificationSent: request.notificationSent
				});
				
				var messagesRef = newAlertRef.child('messages');
				snapshot.child("messages").forEach(function(messagSnap) {
					var messageRequest = messagSnap.val();
					
					var newMessageRef = messagesRef.push();
					newMessageRef.set({
					  message: messageRequest.message,
					  time: messageRequest.time,
					  user: messageRequest.user
					});
				});
				
				// Eintrag in alerts löschen
				alertsRef.child(snapshot.key).remove();
			}
		});
	});

	console.log("cron job completed");
}); 
cronJob.start();
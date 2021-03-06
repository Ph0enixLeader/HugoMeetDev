import React, {useState, useEffect} from "react";
import {useHistory, useParams} from "react-router-dom";

import config from "../../config";
import Utils from "../../utils/utils";
import HangUpIcon from "./assets/HandUpIcon.png";

import "./roomPageCSS.css";

let PeersConnection = new Map();

export default function	RoomPage() {
	const [_LoadingMessage, set_LoadingMessage] = useState("Loading...");
	const [_Peers, set_Peers] = useState([]);
	const [_SelfId, set_SelfId] = useState("");
	const [_IsMuted, set_IsMuted] = useState(false);
	const [_IsCameraOn, set_IsCameraOn] = useState(true);

	const history = useHistory();

	let { roomId } = useParams();

	///////////////////////////////////////////////////////////////////////////////
	//	DataChanel

	function	DConOpen(peerId) {
		console.log(`DC_${peerId}:\tConnected`);
	}

	function	DConMessage(peerId, msg) {
		console.log(`DC_${peerId}:\tMessage Receveived`, msg.data);

		if (msg.data.type === "muteStateChange") {
			const peer = PeersConnection.get(msg.data.id);
			if (peer) {
				console.log(`>>>>>>>>>> ${msg.data.id} is now ${msg.data.isMuted ? "muted" : "unmuted"}`);
			}
			else {
				console.warn(`DC_${peerId}:\tMR:\tPeerId`, msg.data.id, `does not belong to anyone`);
			}
		}
	}

	function	DConClose(peerId) {
		console.log(`DC_${peerId}:\tDisconnected`);
	}

	function	initDCFunctions(dataChannel, peerId) {
		dataChannel.onopen = () => DConOpen(peerId);
		dataChannel.onmessage = (msg) => DConMessage(peerId, msg);
		dataChannel.onclose = () => DConClose(peerId);
	}

	function	sendMessageToEveryoneInTheRoom(msg) {
		// send message to everyone in the room excepte you
		const peersRTCObjs = PeersConnection.values();
		for (const peerRtcObj of peersRTCObjs) {
			if (peerRtcObj.id !== _SelfId) {
				if (peerRtcObj.DC && peerRtcObj.DC.readyState === "open") {
					peerRtcObj.DC.send(msg);
				}
				else {
					console.log(`DC:\tIs disconnected`, peerRtcObj);
				}
			}
		}
	}

	///////////////////////////////////////////////////////////////////////////////
	//	WebRTC

	// When a new client wish to connect with you
	function	sendAnswerBasedOffer(offer, peerId, options) {
		console.log(`WebRTC:\t>>> Client_${peerId} send you an Offer <<<`, options);
		let newConnection = new RTCPeerConnection(options);

		newConnection.onicecandidate = (e) => {
			if (!e.candidate) {
				// This function is triggered one last time with an empty candidate when all candidate are send
				// And if the first triggered has a empty candidate it mean that theyr is a wrong closure at the previous webrtc session
				return;
			}

			let descriptor = {
				to: peerId,
				type: "IceCandidate",
				iceCandidate: e.candidate
			}
			console.log(`WebRTC:\tSend ICE to Client_${peerId}\t${e.candidate.type}`);
			window.SignalingSocket.send(JSON.stringify(descriptor));
		}

		newConnection.ondatachannel = (event) => {
			// this function will be executed when the two peers has set theyr local/remote description
			const peerConnection = PeersConnection.get(peerId);
			peerConnection.DC = event.channel;
			initDCFunctions(peerConnection.DC, peerId);
		};

		if (window.localStream) {
			// Send your streams to the peer (Audio/Video)
			window.localStream.getTracks().forEach((track) => newConnection.addTrack(track, window.localStream));
		}
		newConnection.ontrack = (event) => {
			// When you receive streams from the peer
			console.log(`WebRTC:\tYou received STREAM from Client_${peerId}`);
			const video = document.getElementById(`VideoStream_${peerId}`);
			video.onloadeddata = () => video.play();
			video.srcObject = event.streams[0];
		}

		// Set local description of the peer
		newConnection.setRemoteDescription(offer)
		.then(() => console.log(`WebRTC:\tClient_${peerId}:\tRemote description set`));

		// Create/Set your own local description
		newConnection.createAnswer()
		.then((answer) => {
			newConnection.setLocalDescription(answer)
			.then(() => console.log(`WebRTC:\tLocal description set`));

			// Send your local description to the peer
			let descriptor = {
				to: peerId,
				type: "Answer",
				answer: answer
			}
			console.log(`WebRTC:\tSend Answer to Client_${peerId}`);
			window.SignalingSocket.send(JSON.stringify(descriptor));
		})

		return ({
			PC: newConnection,
			DC: null // We return null because DC will be set when `ondatachannel` will be triggered
		});
	}

	// when you ask a peer to be connected with
	function	createNewPeerConnection(peerId, options) {
		console.log(`WebRTC:\t>>> Create peer connection with: Client_${peerId} <<<`, options);
		let newConnection = new RTCPeerConnection(options);

		newConnection.onicecandidate = (e) => {
			if (!e.candidate) {
				// This function is triggered one last time with an empty candidate when all candidate are send
				// And if the first triggered has a empty candidate it mean that theyr is a wrong closure at the previous webrtc session
				return;
			}

			// When you create a new ice, send it to the peer
			let descriptor = {
				to: peerId,
				type: "IceCandidate",
				iceCandidate: e.candidate
			}
			console.log(`WebRTC:\tSend ICE to Client_${peerId}`);
			window.SignalingSocket.send(JSON.stringify(descriptor));
		}

		let dataChannel = newConnection.createDataChannel(`HugoMeet_${roomId}`);
		initDCFunctions(dataChannel, peerId);

		// TODO: Make sure of the importance of this line (I think it's already set to `sendrecv`)
		newConnection.addTransceiver("video", { direction: "sendrecv",  });

		if (window.localStream) {
			// Send your streams to the peer (Audio/Video)
			window.localStream.getTracks().forEach((track) => newConnection.addTrack(track, window.localStream));
		}
		newConnection.ontrack = (event) => {
			// When you receive streams from the peer
			console.log(`WebRTC:\tYou received STREAM from Client_${peerId}`);
			const video = document.getElementById(`VideoStream_${peerId}`);
			video.onloadeddata = () => video.play();
			video.srcObject = event.streams[0];
		}

		// Create/Set your own local description
		newConnection.createOffer()
		.then((offer) => {
			newConnection.setLocalDescription(offer)
			.then(() => console.log(`WebRTC:\tLocal description set`));

			// send local description to the peer
			let descriptor = {
				to: peerId,
				type: "Offer",
				offer: offer
			}
			console.log(`WebRTC:\tSend Offer to Client_${peerId}`);
			window.SignalingSocket.send(JSON.stringify(descriptor));
		})

		return ({
			PC: newConnection,
			DC: dataChannel
		});
	}

	function	RTCMessageDispatcher(msg) {
		if (msg.type === "Offer") {
			// somemone new has join the room and send you an offer start a peer connection
			PeersConnection.set(msg.from, {
				id: msg.from,
				...sendAnswerBasedOffer(msg.offer, msg.from, msg.peerConnectionOptions)
			});
		}

		let connection = PeersConnection.get(msg.from);
		if (!connection) {
			throw Error("You receive a answer from a undefined peer");
		}

		if (msg.type === "Answer") {
			// someone reponce to your offer with is own local description
			console.log(`WebRTC:\tClient_${msg.from}:\tAnswer received`);

			// set the local description of the remote peer
			connection.PC.setRemoteDescription(msg.answer)
			.then(() => console.log(`WebRTC:\tClient_${msg.from} Remote description set`));
		}
		else if (msg.type === "IceCandidate") {
			if (!msg.iceCandidate) {
				console.error(`WebRTC:\tClient_${msg.from}:\tSend you a not valid ICE candidate`);
				return;
			}

			// You received a new ICE from one of your remote peers
			console.log(`WebRTC:\tClient_${msg.from}:\tICE received`);

			// /!\ It's actually very important to add ICE because they change the local description of the remote peer
			// /!\ and if you don't do it, your peer will have a local description who isn't matching with the one you added with `setRemoteDescription`
			// /!\ and you will be DISCONNECTED has soon has it was connected
			const ice = new RTCIceCandidate(msg.iceCandidate);
			connection.PC.addIceCandidate(ice)
			.then(() => console.log(`WebRTC:\tAdd new ICE from Client_${msg.from}\t${ice.type}`));
		}
	}

	async function	initialiseLocalVideo(selfId) {
		if (!_IsCameraOn && _IsMuted) {
			// can't init device with all the constraints has `false`
			return;
		}
		if (!navigator.mediaDevices) {
			set_LoadingMessage("Failed, Unable to load: Untrusted");
			alert("This site is untrusted we can access to the camera and microphone !");
			return;
		}

		// get Audio and Video
		await navigator.mediaDevices.getUserMedia({ audio: !_IsMuted, video: _IsCameraOn })
		.then(function(localStream) {
			const video = document.getElementById(`VideoStream_${selfId}`);
			video.onloadedmetadata = () => video.play(); // play once video stream is setup
			video.muted = true;	// Mute my own vide to avoid hearing myself
			video.srcObject = localStream;
			window.localStream = localStream;
		})
		.catch((e) => {
			switch (e.name) {
				case "NotFoundError":
					alert("Unable to open your call because no camera and/or microphone were found");
					break;
				case "SecurityError":
				case "PermissionDeniedError":
					break;
				default:
					alert("Error opening your camera and/or microphone: " + e.message);
					break;
			}
		});
	}

	async function	onRoomConnectionEstablish(msg) {
		set_Peers(msg.peers);
		set_SelfId(msg.selfId);

		// We wait because to initialise `window.localstream`
		// If we don't we will be unable to send video/audio streams to the Peers
		await initialiseLocalVideo(msg.selfId);

		// Connect with all peers in the room
		for (const peer of msg.peers) {
			if (peer.id !== msg.selfId) {
				PeersConnection.set(peer.id, {
					...peer,
					...createNewPeerConnection(peer.id, msg.peerConnectionOptions)
				});
			}
		}
	}

	///////////////////////////////////////////////////////////////////////////////
	//	Web Socket

	function	WSonMessage(msg) {
		try {
			// WebSocket message are always stringify JSON (in my case)
			msg = JSON.parse(msg.data);
		} catch (err) {
			console.error(`Cannot parse message: ${msg.data}\nError: ${err}`);
			return ;
		}

		if (msg.type === "ConnectionCallback") {
			// once you sucessfully been connected to the room (msg contain all the initialising value)
			onRoomConnectionEstablish(msg);
		}
		else if (msg.type === "clientJoin" || msg.type === "clientLeave") {
			// I have to send all the clients in `msg.peer` because for some reason `_Peers` is empty in this function
			set_Peers(msg.peers);
		}
		else if (Utils.rtc.isRTCMessage(msg.type)) {
			// msg.type === Offer | Answer | IceCandidate
			RTCMessageDispatcher(msg);
		}
		else {
			console.error(`Msg dropped because type ${msg.type} is unknown`);
		}
	}

	function	WSonOpen() {
		set_LoadingMessage("SUCCEEDED: Connection to the Signaling server establish.");
		setTimeout(() => {
			set_LoadingMessage("");
		}, 5000);
	}

	function	WSonClose(event) {
		console.log(`WS close: ${event.code}${event.reason && ` - ${event.reason}`}`, event);
		history.push(`/`);
	}

	function	WSonError(event) {
		console.log(`WS error:`, event);
		history.push(`/`);
	}

	function	connectClient(roomId) {
		set_LoadingMessage("Connection to the Signaling Server...");
		if (!window.WebSocket) {
			set_LoadingMessage("FAILED: Your browser's version is to old.");
		}

		// connect to signalling server
		window.SignalingSocket = new window.WebSocket(`${config.url_signaling}?roomid=${roomId}`);

		window.SignalingSocket.onopen = WSonOpen;
		window.SignalingSocket.onmessage = WSonMessage;
		window.SignalingSocket.onclose = WSonClose;
		window.SignalingSocket.onerror = WSonError;
	}

	///////////////////////////////////////////////////////////////////////////////
	//	UseEffect

	useEffect(() => {
		// When your micro status change
		if (window.localStream) {
			const audiTracks = window.localStream.getAudioTracks();
			if (audiTracks.length > 0) { // If was alread initialised

				// switch between mute and unmute
				audiTracks.forEach((track) => {
					track.enabled = !_IsMuted;
				});
				sendMessageToEveryoneInTheRoom(JSON.stringify({ type: "muteStateChange", id: _SelfId, isMuted: _IsMuted }));
			}
			else {
				// no videoTracks mean the client was already muted when he connect so the audio track were never create
				navigator.mediaDevices.getUserMedia({ audio: true })
				.then((localStream) => {

					const newTracks = window.localStream.getVideoTracks();
					newTracks.forEach((track) => {
						localStream.addTrack(track);
					});

					// Update srcObject with the localstream with the new audio tracks
					const video = document.getElementById(`VideoStream_${_SelfId}`);
					video.srcObject = localStream;
					window.localStream = localStream;

					sendMessageToEveryoneInTheRoom(JSON.stringify({ type: "muteStateChange", id: _SelfId, isMuted: false }));
				});
			}
		}
	}, [_IsMuted]);

	useEffect(() => {
		// when you camera state change
		if (window.localStream) {
			if (!_IsCameraOn) {
				// If `_IsCameraOn` is FALSE it mean it was TRUE before, so close the video stream
				window.localStream.getVideoTracks().forEach((track) => {
					track.stop();
				});
			}
			else {
				// If `_IsCameraOn` is TRUE it mean it was FALSE before, so restart webcam
				navigator.mediaDevices.getUserMedia({ video: true })
				.then((localStream) => {

					const newTracks = window.localStream.getAudioTracks();
					newTracks.forEach((track) => {
						localStream.addTrack(track);
					});

					const video = document.getElementById(`VideoStream_${_SelfId}`);
					video.srcObject = localStream;
					window.localStream = localStream;
				});
			}
		}
	}, [_IsCameraOn]);

	// Constructor, will be excuted only once
	useEffect(() => {
		if (Utils.idGenerator.isRoomIDValid(roomId) && (!window.SignalingSocket || window.SignalingSocket.readyState === 3)) {
			connectClient(roomId);
		}
	});

	// If you enter in a room with a wrong RoomId, expulse to
	useEffect(() => {
		if (!Utils.idGenerator.isRoomIDValid(roomId)) {
			history.push("/");
		}
	}, [roomId]);

	// TODO: find math to remove that crap
	const numberOfColumns = {
		1: 1,
		2: 2,
		3: 2,
		4: 2,
		5: 3,
		6: 3,
		7: 3,
		8: 3,
		9: 3,
		10: 4,
		11: 4,
	};

	///////////////////////////////////////////////////////////////////////////////
	//	Render

	console.log("RoomPage:\tRefresh");
	return (
		<div className="RoomPage">
			{_LoadingMessage !== "" &&
				<div className="RP-InformationMessage">
					{_LoadingMessage}
				</div>
			}
			{/* VIDEOS */}
			<div className="RP-VideoContainer" style={{ gridTemplateColumns: `${"auto ".repeat(numberOfColumns[_Peers.length])}` }}>
				{_Peers.map((peer, index) =>
					<div key={index} className="RP-VC-Peer">
						<video className="RP-VC-P-Video" id={`VideoStream_${peer.id}`} />
						<div className="RP-VC-P-Name">
							{peer.id}
						</div>
					</div>
				)}
			</div>
			{/* BUTTONS UNDER VIDEOS */}
			<div className="RP-ToolsBox">
				<div className="RP-TB-Left">
					{`Welcome to room: ${roomId}`}
				</div>
				<div className="RP-TB-Center">
					<div className={`RP-TB-C-Button-${!_IsMuted ? "On" : "Off"} Center-Button-MicroStatus`} onClick={() => set_IsMuted(!_IsMuted)}>
						{!_IsMuted ?
							// Icon micro turn on
							<svg focusable="false" width="24" height="24" viewBox="0 0 24 24">
								<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"></path>
								<path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"></path>
							</svg>
							:
							// Icon micro turn off
							<svg xmlns="http://www.w3.org/2000/svg" width="24px" height="24px" viewBox="0 0 24 24">
								<path d="M0 0h24v24H0zm0 0h24v24H0z" fill="none"></path>
								<path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"></path>
							</svg>
						}
					</div>
					<div className={`RP-TB-C-Button-${_IsCameraOn ? "On" : "Off"} Center-Button-CameraStatus`} onClick={() => set_IsCameraOn(!_IsCameraOn)}>
						{_IsCameraOn ?
							// Icon camera turn on
							<svg focusable="false" width="24" height="24" viewBox="0 0 24 24">
								<path d="M18 10.48V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4.48l4 3.98v-11l-4 3.98zm-2-.79V18H4V6h12v3.69z"></path>
							</svg>
							:
							// Icon camera turn off
							<svg focusable="false" width="24" height="24" viewBox="0 0 24 24">
								<path d="M18 10.48V6c0-1.1-.9-2-2-2H6.83l2 2H16v7.17l2 2v-1.65l4 3.98v-11l-4 3.98zM16 16L6 6 4 4 2.81 2.81 1.39 4.22l.85.85C2.09 5.35 2 5.66 2 6v12c0 1.1.9 2 2 2h12c.34 0 .65-.09.93-.24l2.85 2.85 1.41-1.41L18 18l-2-2zM4 18V6.83L15.17 18H4z"></path>
							</svg>
						}
					</div>
					<div className={`RP-TB-C-Button-Off Center-Button-LeaveRoom`} onClick={() => history.push("/")}>
						<img className="RP-TB-C-B-CBL-Img" alt="Leave the call" src={HangUpIcon} />
					</div>
				</div>
				<div className="RP-TB-Right">
					{/* Nothing Yet */}
				</div>
			</div>
		</div>
	);
};
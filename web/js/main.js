const API_VERSION = 1.0

var subdir = window.location.pathname.endsWith("/") ? window.location.pathname : window.location.pathname + "/";

var base64Domain = getUrlParam("base64domain", false);

//ALL GET PARAMETERS
var socketDomain = getUrlParam("socketdomain", false); //Domainname with path
var camOnAtStart = getUrlParam("camon", false) ? true : false; //Defines if cam should be on at start
var username = getUrlParam("username", "NA");
var roomname = getUrlParam("roomname", "unknown");

if (base64Domain && socketDomain) {
  socketDomain = atob(socketDomain);
}

var socket;
if (socketDomain) {
  socketDomain = socketDomain.replace('https://', '').replace('http://', '').split("#")[0];
  var domainSplit = socketDomain.split('/');
  socketDomain = 'https://' + domainSplit[0];
  domainSplit.shift();
  subdir = '/' + domainSplit.join('/');
  subdir = subdir.endsWith('/') ? subdir : subdir + '/';
  console.log('socketDomain', socketDomain);
  console.log('subdir', subdir);
  socket = io(socketDomain, { "path": subdir + "socket.io" })
} else {
  socket = subdir == "/" ? io() : io("", { "path": subdir + "/socket.io" }); //Connect to socketIo even on subpaths
}

var webRTCConfig = {};

var allUserStreams = {};
var pcs = {}; //Peer connections to all remotes
var socketConnected = false;
var micMuted = false;
var camActive = false;

socket.on("connect", function () {
  socketConnected = true;


  socket.on("API_VERSION", function (serverAPI_VERSION) {
    if (API_VERSION != serverAPI_VERSION) {
      alert("SERVER has a different API Version (Client: v" + API_VERSION + " Server: v" + serverAPI_VERSION + ")! This can cause problems, so be warned!")
    }
  })

  socket.on("signaling", function (data) {
    var signalingData = data.signalingData;
    var fromSocketId = data.fromSocketId;
    if (!pcs[fromSocketId]) {
      createRemoteSocket(false, fromSocketId)
    }
    pcs[fromSocketId].signaling(signalingData);

    if (data.username) {
      allUserStreams[fromSocketId] = allUserStreams[fromSocketId] ? allUserStreams[fromSocketId] : {};
      allUserStreams[fromSocketId]["username"] = data.username;
    }
  })

  socket.on("userJoined", function (content) {
    var userSocketId = content["socketId"];
    createRemoteSocket(true, userSocketId)
  })

  socket.on("userDiscconected", function (userSocketId) {
    delete allUserStreams[userSocketId];
    $('audio' + userSocketId).remove();
    updateUserLayout();
  })

  socket.on("currentIceServers", function (newIceServers) {
    console.log("got newIceServers", newIceServers)
    webRTCConfig["iceServers"] = newIceServers;
  })

  navigator.getUserMedia({
    video: false, // { 'facingMode': "user" }
    audio: { 'echoCancellation': true, 'noiseSuppression': true }
  }, function (stream) { //OnSuccess
    webRTCConfig["stream"] = stream;
    console.log('getUserMedia success! Stream: ', stream);

    var audioTracks = stream.getAudioTracks();

    if (audioTracks.length >= 1) {
      allUserStreams[socket.id] = {
        audiostream: stream,
        username: username
      }
    }

    if (audioTracks.length > 0) {
      console.log('Using audio device: ' + audioTracks[0].label);
    }

    joinRoom();
    updateUserLayout();
    if (camOnAtStart) { //enable cam on start if set
      setTimeout(function () {
        $("#addRemoveCameraBtn").click();
      }, 1000)
    }
  }, function (error) { //OnError
    alert("Could not get your Camera / Mic!")
    console.log('getUserMedia error! Got this error: ', error);
  });

});

$(window).on("beforeunload", function () {
  if (socketConnected) {
    socket.emit('closeConnection', null);
  }
})

$(document).ready(function () {
  $("#muteUnmuteMicBtn").click(function () {
    if (!micMuted) {
      $("#muteUnmuteMicBtn").html('<i class="fas fa-microphone-alt-slash"></i>');
      if (allUserStreams[socket.id] && allUserStreams[socket.id]["audiostream"]) {
        allUserStreams[socket.id]["audiostream"].getAudioTracks()[0].enabled = false;
      }
    } else {
      $("#muteUnmuteMicBtn").html('<i class="fas fa-microphone-alt"></i>');
      if (allUserStreams[socket.id] && allUserStreams[socket.id]["audiostream"]) {
        allUserStreams[socket.id]["audiostream"].getAudioTracks()[0].enabled = true;
      }
    }
    micMuted = !micMuted;
  })

  $("#addRemoveCameraBtn").click(function () {
    if (!camActive) {
      $("#addRemoveCameraBtn").css({ color: "#030356" });
      navigator.getUserMedia({
        video: { 'facingMode': "user" },
        audio: false
      }, function (stream) { //OnSuccess
        for (var i in pcs) { //Add stream to all peers
          pcs[i].addStream(stream);
        }

        console.log('getUserMedia success! Stream: ', stream);
        console.log('LocalStream', stream.getVideoTracks());

        var videoTracks = stream.getVideoTracks();

        if (videoTracks.length >= 1) {
          allUserStreams[socket.id] = allUserStreams[socket.id] ? allUserStreams[socket.id] : {};
          allUserStreams[socket.id]["videostream"] = stream;
        }

        if (videoTracks.length > 0) {
          console.log('Using video device: ' + videoTracks[0].label);
        }

        updateUserLayout();
        camActive = true;
      }, function (error) { //OnError
        alert("Could not get your Camera!")
        console.log('getUserMedia error! Got this error: ', error);
        $("#addRemoveCameraBtn").css({ color: "black" });
      });
    } else {
      $("#addRemoveCameraBtn").css({ color: "black" });
      for (var i in pcs) { //remove stream from all peers
        pcs[i].removeStream(allUserStreams[socket.id]["videostream"]);
      }
      delete allUserStreams[socket.id]["videostream"];
      socket.emit('removeCamera', true)
      updateUserLayout();
      camActive = false;
    }
  });


  $("#cancelCallBtn").click(function () {
    if (window.x_extended && typeof window.x_extended.close === "function") { //Close window if we run in electron app
      window.x_extended.close()
    } else {
      alert("Please close this window / tab!");
    }
  })
})

//This is where the WEBRTC Magic happens!!!
function createRemoteSocket(initiator, socketId) {
  pcs[socketId] = new initEzWebRTC(initiator, webRTCConfig); //initiator
  pcs[socketId].on("signaling", function (data) {
    socket.emit("signaling", { destSocketId: socketId, signalingData: data })
  })
  pcs[socketId].on("stream", function (stream) {
    gotRemoteStream(stream, socketId)
  });
  pcs[socketId].on("streamremoved", function (stream, kind) {
    console.log("STREAMREMOVED!")

    if (kind == "video") {
      delete allUserStreams[socketId]["videostream"];
      updateUserLayout();
    }

  });
  pcs[socketId].on("closed", function (stream) {
    delete allUserStreams[socketId];
    $('audio' + socketId).remove();
    updateUserLayout();
    console.log("disconnected!");
  });

  pcs[socketId].on("connect", function () {
    if (allUserStreams[socket.id]["videostream"]) {
      setTimeout(function () {
        pcs[socketId].addStream(allUserStreams[socket.id]["videostream"])
      }, 500)
    }
  });
}

function gotRemoteStream(stream, socketId) {
  var videoTracks = stream.getVideoTracks();
  var audioTracks = stream.getAudioTracks();

  console.log("videoTracks", videoTracks)
  console.log("audioTracks", audioTracks)

  $("#" + socketId).remove();
  allUserStreams[socketId] = allUserStreams[socketId] ? allUserStreams[socketId] : {};
  if (videoTracks.length >= 1) { //Videosteam
    allUserStreams[socketId]["videostream"] = stream;
  } else {
    allUserStreams[socketId]["audiostream"] = stream;
  }

  updateUserLayout();
};

function updateUserLayout() {
  if (document.fullscreenElement) { //Dont do things on fullscreen
    return;
  }
  var streamCnt = 0;
  var allUserDivs = {};
  for (var i in allUserStreams) {
    var userStream = allUserStreams[i];
    streamCnt++;
    console.log(userStream["username"])
    var uDisplay = userStream["username"] && userStream["username"] != "NA" ? userStream["username"].substr(0, 2).toUpperCase() : i.substr(0, 2).toUpperCase();
    var userDiv = $('<div class="videoplaceholder" style="position:relative;" id="' + i + '">' +
      '<div class="userPlaceholderContainer" style="width:100%; height:100%; position:absolute; overflow:hidden; background: #474747;">' +
      '<div class="userPlaceholder">' + uDisplay + '</div>' +
      '</div>' +
      '</div>')

    console.log(userStream)

    if (userStream["audiostream"] && i !== socket.id) {
      if ($("#audioStreams").find('#audio' + i).length == 0) {
        let audioDiv = $('<div id="audio' + i + '" style="display:none;"><audio autoplay></audio></div>');
        audioDiv.find("audio")[0].srcObject = userStream["audiostream"];
        $("#audioStreams").append(audioDiv);
      }
    }

    if (userStream["videostream"]) {
      var mirrorStyle = ""
      if (i == socket.id) {
        mirrorStyle = "transform: scaleX(-1);"
      }
      var userDisplayName = userStream["username"] && userStream["username"] != "NA" ? (userStream["username"].charAt(0).toUpperCase() + userStream["username"].slice(1)) : i.substr(0, 2).toUpperCase();
      userDiv.append(
        '<div class="userCont" style="position: absolute; width: 100%; height: 100%;">' +
        '<div id="video' + i + '" style="top: 0px; width: 100%;">' +
        '<div style="position: absolute; color: white; top: 7px; left: 7px; font-size: 1.3em; z-index:10; text-shadow: 1px 0 0 #000, 0 -1px 0 #000, 0 1px 0 #000, -1px 0 0 #000;">' + userDisplayName + '</div>' +
        '<video style="' + mirrorStyle + '" autoplay muted></video>' +
        '</div>' +
        '</div>');
      userDiv.find("video")[0].srcObject = userStream["videostream"];
      userDiv.find(".userPlaceholderContainer").hide();

      if (i != socket.id) {
        userDiv.find("video").css({"cursor": "pointer"})
        userDiv.find("video").click(function () {
          openFullscreen(this);
        })
      }
    }

    allUserDivs[i] = userDiv;
  }

  $("#mediaDiv").empty();

  if (streamCnt == 2) { //Display 2 users side by side
    for (var i in allUserDivs) {
      if (i == socket.id) {
        allUserDivs[i].css({ width: '20%', height: '30%', position: 'absolute', left: '20px', bottom: '30px', 'z-index': '1' });
      } else {
        allUserDivs[i].css({ width: '100%', height: '100%', float: 'left' });
      }

      $("#mediaDiv").append(allUserDivs[i])
    }

  } else {
    var lineCnt = Math.round(Math.sqrt(streamCnt));
    for (var i = 1; i < lineCnt + 1; i++) {
      $("#mediaDiv").append('<div id="line' + i + '"></div>')
    }
    let userPerLine = streamCnt <= 2 ? 1 : Math.ceil(streamCnt / lineCnt);
    console.log(userPerLine)
    let cucnt = 1;
    for (var i in allUserDivs) {
      var cLineNr = Math.ceil(cucnt / userPerLine);
      allUserDivs[i].css({ width: 100 / userPerLine + '%', height: 100 / lineCnt + '%', float: 'left' });
      $("#line" + cLineNr).append(allUserDivs[i])
      cucnt++;
    }

    var lastLineElsCnt = $("#line" + lineCnt).find(".videoplaceholder").length;
    // console.log(lastLineElsCnt, userPerLine)
    if (lastLineElsCnt != userPerLine) {
      var p = (100 / userPerLine) / 2;
      $("#line" + lineCnt).find(".videoplaceholder").css({ "left": p + "%" })
    }
  }

  $.each($(".userCont"), function () {
    var w = $(this).width();
    var h = $(this).height();
    $(this).find("video").css({ "max-width": w + 'px', "max-height": h + 'px' })
    $(this).find("video")[0].play();
  })
}

function joinRoom() {
  //Only join the room if local media is active!
  var roomname = getUrlParam("roomname", "unknown");
  socket.emit("joinRoom", { roomname: roomname, username: username }, function () {
    console.log("joined room", roomname)
  });
}

var resizeTimeout = null;
window.onresize = function (event) {
  if (resizeTimeout) {
    clearTimeout(resizeTimeout);
  }

  resizeTimeout = setTimeout(function () {
    updateUserLayout();
  }, 2000)
};

function openFullscreen(elem) {
  if (elem.requestFullscreen) {
    elem.requestFullscreen();
  } else if (elem.mozRequestFullScreen) { /* Firefox */
    elem.mozRequestFullScreen();
  } else if (elem.webkitRequestFullscreen) { /* Chrome, Safari and Opera */
    elem.webkitRequestFullscreen();
  } else if (elem.msRequestFullscreen) { /* IE/Edge */
    elem.msRequestFullscreen();
  }
}
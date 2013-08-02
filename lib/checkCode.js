var ccc = require("./ccc");
var automatedTesting = require("./automatedTesting");
var CONST = require("./const");

const {Cc,Ci,Cr} = require("chrome");
if (typeof CCIN == "undefined") {
	function CCIN(cName, ifaceName){
		return Cc[cName].createInstance(Ci[ifaceName]);
	}
}
if (typeof CCSV == "undefined") {
	function CCSV(cName, ifaceName){
		if (Cc[cName])
			// if fbs fails to load, the error can be _CC[cName] has no properties
			return Cc[cName].getService(Ci[ifaceName]); 
		else
			dumpError("CCSV fails for cName:" + cName);
	};
}
var window = Cc["@mozilla.org/appshell/appShellService;1"].getService(Ci.nsIAppShellService).hiddenDOMWindow;
var accounts;
var inheritedPhase = 9999;
var sawDialogOAuth = false;
var delayRefreshTestTabTimer = 0;
var checkLoginButtonRemovedTimer = 0;
var delayRefreshCalled = false;

var nextModule = function (){
	automatedTesting.finishedTesting(true);
}

var levenshteinDistance = function(a, b){
  if(a.length == 0) return b.length; 
  if(b.length == 0) return a.length; 
 
  var matrix = [];
 
  // increment along the first column of each row
  var i;
  for(i = 0; i <= b.length; i++){
    matrix[i] = [i];
  }
 
  // increment each column in the first row
  var j;
  for(j = 0; j <= a.length; j++){
    matrix[0][j] = j;
  }
 
  // Fill in the rest of the matrix
  for(i = 1; i <= b.length; i++){
    for(j = 1; j <= a.length; j++){
      if(b.charAt(i-1) == a.charAt(j-1)){
        matrix[i][j] = matrix[i-1][j-1];
      } else {
        matrix[i][j] = Math.min(matrix[i-1][j-1] + 1, // substitution
                                Math.min(matrix[i][j-1] + 1, // insertion
                                         matrix[i-1][j] + 1)); // deletion
      }
    }
  }
 
  return matrix[b.length][a.length];
};

var RequestRecord = function(){
	this.cookies = "";
	this.postDATA = "";
	this.url = "";
}

var ResponseRecord = function(){
	this.setCookies = "";
	this.body = "";
	this.url = "";
}

var bufferedRequests = {};					//used to store freshly captured requests
var bufferedResponses = {};
var modifiedResponseContent = "";			//used to store modified response content from testSuite.js
var displayFirstName = false;
var displayLastName = false;
var displayEmail = false;
var displayPicSRC = false;
var displayPicSRC2 = false;
var displayPicSRC3 = false;
var displayPicSRC4 = false;
var displayFBID = false;

if (typeof String.prototype.startsWith != 'function') {
	String.prototype.startsWith = function (str){
		return this.indexOf(str) == 0;
	};
}

var checkCode = function(storageRecord)
{
	if (!storageRecord.facebookDialogOAuthResponse) {ccc.log("Error: facebookOAuthResponse is undefined!"); return false;}
	var res = storageRecord.facebookDialogOAuthResponse.body;
	if (!ccc.usedFBSDK()) res = storageRecord.facebookDialogOAuthResponse.url;		//means the app didn't use the SDK, which means the actual redirect url is in the 302 url, as opposed to javascript content.
	ccc.log(res);
	if (typeof res == "undefined") {ccc.log("Error: facebookOAuthResponse URL/content empty!"); return false;}
	if (res.indexOf('code=')!=-1) {
		ccc.log("Code exists in this traffic.");
		ccc.log("Now try to verify this exploit");
		return true;
	}
	else {
		ccc.log("Code NOT spotted in this traffic.");
		ccc.log(ccc.siteToTest() + " is not vulnerable to [2], code not spotted.", true);
		nextModule();
		return false;
	}
}

var verifyThreat = function(testSuiteWorker)
{
	ccc.deleteCookies();
	try {
		testSuiteWorker.port.emit("action",{"action": "navigateTo", "site":ccc.siteToTest()});
	} catch (ex) {
		ccc.log('waiting for page to load...');
	}
}

var checkAgainstFilter = function(url, capturingPhase)
{
	var i = 0;
	if (capturingPhase == inheritedPhase + 1 && (url.indexOf("http://www.facebook.com/dialog/return")==0 || url.indexOf("https://www.facebook.com/dialog/return")==0)) 
	{
		//special situation for websites using social plugin button.php, see mapquest.com as an example.
		return true;
	}
	if (capturingPhase == inheritedPhase)
	{
		for (i = 0; i < ccc.capturingURLs().length; i++)
		{
			if (url.startsWith(ccc.capturingURLs()[i])) {
				return true;
			}
		}
		return false;
	}
	else if (capturingPhase == inheritedPhase + 1){
		//check idp domains and excluded patterns
		for (i = 0; i < ccc.excludedPattern.length; i++)
		{
			if (url.indexOf(ccc.excludedPattern[i])!=-1) {
				return false;
			}
		}
		for (i = 0; i < ccc.IdPDomains.length; i++)
		{
			if (url.startsWith(ccc.IdPDomains[i])) {
				return true;
			}
		}
		return false;
	}
	else if (capturingPhase == inheritedPhase + 2 && ccc.usedFBSDK()){
		//check idp domains and excluded patterns
		for (i = 0; i < ccc.excludedPattern.length; i++)
		{
			if (url.indexOf(ccc.excludedPattern[i])!=-1) {
				return false;
			}
		}
		for (i = 0; i < ccc.IdPDomains.length; i++)
		{
			if (url.startsWith(ccc.IdPDomains[i])) {
				return true;
			}
		}
		return false;
	}
	else if (!ccc.usedFBSDK() && ccc.redirectDomain() != "" && capturingPhase == inheritedPhase + 2)
	{
		//we also need to account for visits to redirectDomain
		if (url.startsWith(ccc.redirectDomain())) {
			return true;
		}
	}
	else if (capturingPhase == inheritedPhase + 3 && delayRefreshCalled)
	{
		for (; i < ccc.capturingURLs().length; i++)
		{
			if (url == ccc.capturingURLs()[i] || url.substr(0,url.length-1) == ccc.capturingURLs()[i] || url == ccc.capturingURLs()[i].substr(0, ccc.capturingURLs()[i].length-1)) {
				return true;
			}
		}
		return false;
	}
	return false;
}

function checkLoginButtonRemoved(){
	//note: the following port.on must be declared at runtime to avoid cyclic referencing.
	ccc.pressLoginButtonWorker().port.on("after_modification_sendLoginButtonInformation",  function(response){
		ccc.log("Phase "+(inheritedPhase+4).toString()+": checking login button existence after modification...\n");
		ccc.setCapturingPhase(ccc.capturingPhase() + 1);
		ccc.log("Current login button XPath is: " + response.loginButtonXPath);
		if (response.loginButtonXPath == ccc.loginButtonXPath() || response.loginButtonOuterHTML == ccc.loginButtonOuterHTML()) {
			ccc.log("Modification failed! After Modification the login button is still present!");
			ccc.log(ccc.siteToTest() + " is not vulnerable to [2], login button still present after mod.", true);
			nextModule();
			return;
		}
		ccc.log("Modification successful!, log in button different from anonymous session.");
		checkStructuralDiff();
		return;
	});
	try{
		ccc.pressLoginButtonWorker().port.emit("after_modification_sendLoginButtonInformation", {"indexToClick": ccc.indexToClick(), "tryFindInvisibleLoginButton":ccc.tryFindInvisibleLoginButton(), "account":ccc.accountsInfo()});
	} catch(ex){
		ccc.log("pressloginworker hidden frame error - likely caused by host page still loading, will try again in 10 seconds.");
		checkLoginButtonRemovedTimer = window.setTimeout(checkLoginButtonRemoved, 10000);
	}
}

function checkStructuralDiff(){
	ccc.testSuiteWorker().port.on("after_modification_extractedContent",function(response){
		//ccc.saveToFile(ccc.siteToTest(), ccc.responseTextContent()[1] + "\n---------------\n" + ccc.responseTextContent()[2] + "\n---------------\n" + response);
		//ccc.log("Phase "+(inheritedPhase+5).toString()+": Saved response content to file.");
		ccc.log("Phase "+(inheritedPhase+5).toString()+": Checking extracted content and identifying session owner...\n");
		modifiedResponseContent = response;
		var lowerModifiedResponseContent = modifiedResponseContent.toLowerCase();
		var accounts = ccc.accountsInfo();
		var lower1 = ccc.responseTextContent()[1].toLowerCase();
		var lower2 = ccc.responseTextContent()[2].toLowerCase();
		if (lower1.indexOf(accounts[0].firstName)!=-1&&lower2.indexOf(accounts[1].firstName)!=-1) displayFirstName = true;
		if (lower1.indexOf(accounts[0].lastName)!=-1&&lower2.indexOf(accounts[1].lastName)!=-1) displayLastName = true;
		if (lower1.indexOf(accounts[0].email)!=-1&&lower2.indexOf(accounts[1].email)!=-1) displayEmail = true;
		if (ccc.responseTextContent()[1].indexOf(accounts[0].picSRC)!=-1&&ccc.responseTextContent()[2].indexOf(accounts[1].picSRC)!=-1) displayPicSRC = true;
		if (ccc.responseTextContent()[1].indexOf(accounts[0].picSRC2)!=-1&&ccc.responseTextContent()[2].indexOf(accounts[1].picSRC2)!=-1) displayPicSRC2 = true;
		if (ccc.responseTextContent()[1].indexOf(accounts[0].picSRC3)!=-1&&ccc.responseTextContent()[2].indexOf(accounts[1].picSRC3)!=-1) displayPicSRC3 = true;
		if (ccc.responseTextContent()[1].indexOf(accounts[0].picSRC4)!=-1&&ccc.responseTextContent()[2].indexOf(accounts[1].picSRC4)!=-1) displayPicSRC4 = true;
		if (ccc.responseTextContent()[1].indexOf(accounts[0].fbid)!=-1&&ccc.responseTextContent()[2].indexOf(accounts[1].fbid)!=-1) displayFBID = true;
		
		ccc.log("This website displays " + (displayFirstName ? "first name, ":"" ) + (displayLastName ? "last name, ":"" ) + (displayEmail ? "email, ":"" ) + (displayPicSRC ? "picsrc, ":"" ) + (displayPicSRC2 ? "picsrc2, ":"" ) + (displayPicSRC3 ? "picsrc3, ":"" ) + (displayPicSRC4 ? "picsrc4,":"" ) + (displayFBID ? "fbid.":"" ));
		
		var sessionAScore = 0;
		var sessionBScore = 0;
		if (displayFirstName && lowerModifiedResponseContent.indexOf(accounts[0].firstName)!=-1) sessionAScore++;
		if (displayLastName && lowerModifiedResponseContent.indexOf(accounts[0].lastName)!=-1) sessionAScore++;
		if (displayEmail && lowerModifiedResponseContent.indexOf(accounts[0].email)!=-1) sessionAScore++;
		if (displayPicSRC && modifiedResponseContent.indexOf(accounts[0].picSRC)!=-1) sessionAScore++;
		if (displayPicSRC2 && modifiedResponseContent.indexOf(accounts[0].picSRC2)!=-1) sessionAScore++;
		if (displayPicSRC3 && modifiedResponseContent.indexOf(accounts[0].picSRC3)!=-1) sessionAScore++;
		if (displayPicSRC4 && modifiedResponseContent.indexOf(accounts[0].picSRC4)!=-1) sessionAScore++;
		if (displayFBID && modifiedResponseContent.indexOf(accounts[0].fbid)!=-1) sessionAScore++;
		
		if (displayFirstName && lowerModifiedResponseContent.indexOf(accounts[1].firstName)!=-1) sessionBScore++;
		if (displayLastName && lowerModifiedResponseContent.indexOf(accounts[1].lastName)!=-1) sessionBScore++;
		if (displayEmail && lowerModifiedResponseContent.indexOf(accounts[1].email)!=-1) sessionBScore++;
		if (displayPicSRC && modifiedResponseContent.indexOf(accounts[1].picSRC)!=-1) sessionBScore++;
		if (displayPicSRC2 && modifiedResponseContent.indexOf(accounts[1].picSRC2)!=-1) sessionBScore++;
		if (displayPicSRC3 && modifiedResponseContent.indexOf(accounts[1].picSRC3)!=-1) sessionBScore++;
		if (displayPicSRC4 && modifiedResponseContent.indexOf(accounts[1].picSRC4)!=-1) sessionBScore++;
		if (displayFBID && modifiedResponseContent.indexOf(accounts[1].fbid)!=-1) sessionBScore++;
		
		if (sessionAScore > 0 && sessionBScore == 0) {
			ccc.log("Web application now logged in as session A, threat successful, sessionAscore is: " + sessionAScore.toString());
			ccc.log(ccc.siteToTest() + " is vulnerable to [2]!", true);
			nextModule();
		}
		else if (sessionBScore > 0 && sessionAScore == 0) {
			ccc.log("Web application now logged in as session B, threat failed, sessionBscore is: " + sessionBScore.toString());
			ccc.log(ccc.siteToTest() + " is not vulnerable to [2], code used but session is still Bob's.", true);
			nextModule();
		}
		else {
			ccc.log("Cannot determine login state, here are the scores: "+sessionAScore.toString()+ " " + sessionBScore.toString());
			ccc.log(ccc.siteToTest() + " cannot be determined (score error in [2]).", true);
			nextModule();
		}
	});
	try {ccc.testSuiteWorker().port.emit("action",{"action":"after_modification_extractContent"});} catch (ex){
		window.setTimeout('ccc.testSuiteWorker().port.emit("action",{"action":"after_modification_extractContent"})',10000);
	}
}

function processBuffer(url)
{
	var capturingPhase = ccc.capturingPhase();
	if (capturingPhase == inheritedPhase+1 && checkAgainstFilter(url, capturingPhase) && ccc.loginButtonClicked() && sawDialogOAuth)
	{
		sawDialogOAuth = false;
		ccc.log("Phase "+(inheritedPhase+1).toString()+": Saw FB visit, waiting for code pattern to appear.\n");
		ccc.setCapturingPhase(capturingPhase + 1);
	}
	if (capturingPhase == inheritedPhase+3 && checkAgainstFilter(url, capturingPhase)) {
		ccc.log("Phase "+(inheritedPhase+3).toString()+": revisited the site after code is modified, ready to compare credentials/differences.\n");
		ccc.restoreCapturingURLs();
		//ccc.saveToFile(ccc.siteToTest(), JSON.stringify(ccc.storageRecord()[ccc.siteToTest()]));
		ccc.setCapturingPhase(capturingPhase + 1);
		checkLoginButtonRemovedTimer = window.setTimeout(checkLoginButtonRemoved,10000);				//timing consistent with phase 4.
	}
}

function delayRefreshTestTab()
{
	//This function is only invoked when the site uses javascript (as opposed to reloading) to manipulate after user logs in.
	if (ccc.capturingPhase() == inheritedPhase + 3) {
		ccc.log("Sub-Phase "+(inheritedPhase+2).toString()+".5: revisiting the testing site.");
		try {
			ccc.testSuiteWorker().port.emit("action",{"action": "navigateTo", "site":ccc.siteToTest()});
			delayRefreshCalled = true;
		}
		catch (ex) {
			log("testSuiteWorker worker hidden frame error, page probably still loading... retry in 10 secs");
			delayRefreshTestTabTimer = window.setTimeout(delayRefreshTestTab, 10000);
		}
	}
}

var observerService = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);

observerService.addObserver({
    observe: function(aSubject, aTopic, aData) {
		if ("http-on-modify-request" == aTopic) {
			var gchannel = aSubject.QueryInterface(Ci.nsIHttpChannel)
			var url = gchannel.URI.spec;
			if (!checkAgainstFilter(url, ccc.capturingPhase())) return;									//this filters lots of urls.
			//--------This is the url of interest, we should start recording here--------------
			var postDATA = "";
			var cookies = "";
			var requestRecord = new RequestRecord();
			requestRecord.url = url;
			try {cookies = gchannel.getRequestHeader("cookie");} catch(e){}						//this creates lots of errors if not caught
			requestRecord.cookies = cookies;
			if (gchannel.requestMethod == "POST")
			{
				var channel = gchannel.QueryInterface(Ci.nsIUploadChannel).uploadStream;  
				var prevOffset = channel.QueryInterface(Ci.nsISeekableStream).tell();
				channel.QueryInterface(Ci.nsISeekableStream).seek(Ci.nsISeekableStream.NS_SEEK_SET, 0);  
				var stream = Cc["@mozilla.org/binaryinputstream;1"].createInstance(Ci.nsIBinaryInputStream);  
				stream.setInputStream(channel);  
				var postBytes = stream.readByteArray(stream.available());  			//this is going to mess up with POST action.
				poststr = String.fromCharCode.apply(null, postBytes);  
				
				//This is a workaround that sometimes the POST data contains Content-type and Content-length header.
				//This here may cause a bug, as we are simply discarding all \ns and get the last segment.
				var splitted = poststr.split('\n');									
				poststr = splitted[splitted.length-1];
				requestRecord.postDATA = poststr;
				
				channel.QueryInterface(Ci.nsISeekableStream).seek(Ci.nsISeekableStream.NS_SEEK_SET, prevOffset);
				//This following may alter post data.
				//var inputStream = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
				//inputStream.setData(poststr, poststr.length); 
				//var uploadChannel = gchannel.QueryInterface(Ci.nsIUploadChannel);
				//uploadChannel.setUploadStream(inputStream, "application/x-www-form-urlencoded", -1);
				//uploadChannel.requestMethod = "POST";
			}
			bufferedRequests[url] = requestRecord;
		}
    }
}, "http-on-modify-request", false);


function TracingListener() {
    this.originalListener = null;
	this.receivedData = [];
	this.setCookieHeader = "";
}

TracingListener.prototype =
{
    onDataAvailable: function(request, context, inputStream, offset, count)
    {
        this.originalListener.onDataAvailable(request, context,inputStream, offset, count);
    },

    onStartRequest: function(request, context) {
		var uri = request.URI.spec;
		if ((!ccc.usedFBSDK()) && uri.indexOf('code=')!=-1)
		{
			ccc.log("Phase "+(inheritedPhase+2).toString()+": App does not use SDK: trying to modify code.\n");
			ccc.log("Original (before attack) URI is:" + uri);
			var tail = uri.substr(uri.indexOf('code='), uri.length);
			var andIndex = (tail.indexOf('&') == -1) ? 9999999 : tail.indexOf('&');
			var poundIndex = (tail.indexOf('#') == -1) ? 9999999 : tail.indexOf('#');
			var cutIndex = (andIndex > poundIndex) ? poundIndex : andIndex;
			if (cutIndex != 9999999) tail = tail.substr(cutIndex,tail.length);
			else tail = "";
			request.URI.spec = uri.substr(0,uri.indexOf('code='))+"code="+ccc.accountsInfo()[0].code+tail;							//redirect URI to the threat generated.
			ccc.log(",which is changed to:" + request.URI.spec);
			if (delayRefreshTestTabTimer) window.clearTimeout(delayRefreshTestTabTimer);
			delayRefreshTestTabTimer = window.setTimeout(delayRefreshTestTab,15000);
			ccc.setCapturingPhase(ccc.capturingPhase()+1);
		}
        this.originalListener.onStartRequest(request, context);
    },

    onStopRequest: function(request, context, statusCode)
    {
        // Get entire response
        var responseBody = this.receivedData.join();
		var url = request.URI.spec;										//request.URI means the current URI (after 302 redirect)
		//if (ccc.capturingPhase() == inheritedPhase+1) url = request.originalURI.spec;		//request.originalURI means the first URI (before 302 redirect)
		//For FB, oauth/dialog API is the original URI.
		//Note: originalURI at observe function (outside of this) needs to be URI, not originalURI, lol.
		if (checkAgainstFilter(url, ccc.capturingPhase()))
		{
			var responseRecord = new ResponseRecord();
			responseRecord.url = url;
			responseRecord.body = responseBody.substr(0,400);				//now only record 400 characters
			responseRecord.setCookies = this.setCookieHeader;
			bufferedResponses[url] = responseRecord;
			processBuffer(url);
		}
        this.originalListener.onStopRequest(request, context, statusCode);
    },

    QueryInterface: function (aIID) {
        if (aIID.equals(Ci.nsIStreamListener) ||
            aIID.equals(Ci.nsISupports)) {
            return this;
        }
        throw Cr.NS_NOINTERFACE;
    }
}

var httpRequestObserver =
{
    observe: function(aSubject, aTopic, aData)
    {
        if (aTopic == "http-on-examine-response")
        {
			var gchannel = aSubject.QueryInterface(Ci.nsIHttpChannel)
			var url = gchannel.URI.spec;
			if (checkAgainstFilter(url, ccc.capturingPhase())){
				var notAppsFacebookComDomain = true;
				if (ccc.capturingPhase() == inheritedPhase + 2 && !ccc.usedFBSDK())
				{
					//This helps tackle the 'in-between-hop' two redirects situation seen in pinterest and imgur.
					try {
						var newRedirectURI = gchannel.getResponseHeader('Location');
						var redirectDomain;
						if (newRedirectURI) redirectDomain = newRedirectURI;
						var protocol = redirectDomain.substr(0,redirectDomain.indexOf('/')) + "//";
						redirectDomain = redirectDomain.substr(redirectDomain.indexOf('/')+2,redirectDomain.length);
						redirectDomain = redirectDomain.substr(0,redirectDomain.indexOf('/'));
						redirectDomain = protocol + redirectDomain;
						ccc.setRedirectDomain(redirectDomain);
						ccc.log("Redirect Domain changed to: " + redirectDomain);
					}
					catch(ex){};
				}
				if (ccc.capturingPhase() == inheritedPhase + 3)
				{
					try {
						var newSiteToDetect = gchannel.getResponseHeader('Location');
						if (newSiteToDetect) {
							//still keep the old value so that we can restore it later.
							ccc.pushCapturingURLs(newSiteToDetect);
							ccc.log("capturingURLs appended with: " + newSiteToDetect);
						}
					}
					catch(ex){};
				}
				if (url.startsWith("https://www.facebook.com/dialog/oauth") || url.startsWith("http://www.facebook.com/dialog/oauth")) {
					//eliminate situation where redirect_uri starts with "http://apps.facebook.com".
					if (url.indexOf("static.ak.facebook.com")==-1) {
						var temp = url.substr(url.indexOf('redirect_uri='),url.length);
						temp = decodeURIComponent(temp.substr(13,temp.length));
						if (temp.indexOf('http://apps.facebook.com') == 0 || temp.indexOf('https://apps.facebook.com') == 0)
						{
							notAppsFacebookComDomain = false;
						}
					}
				}
				if ((url.startsWith("https://www.facebook.com/dialog/oauth") || url.startsWith("http://www.facebook.com/dialog/oauth")) && notAppsFacebookComDomain)
				{
					sawDialogOAuth = true;
				}
				var newListener = new TracingListener();
				try {newListener.setCookieHeader = gchannel.getResponseHeader('Set-Cookie');} catch(ex){};		//stupid FF sliently fails if no set-cookie header is present in a response header, STUPID!  This is a workaround.
				aSubject.QueryInterface(Ci.nsITraceableChannel);
				newListener.originalListener = aSubject.setNewListener(newListener);
			}
        }
    },

    QueryInterface : function (aIID)
    {
        if (aIID.equals(Ci.nsIObserver) ||
            aIID.equals(Ci.nsISupports))
        {
            return this;
        }

        throw Cr.NS_NOINTERFACE;

    }
};

exports.shouldClickLoginButton = function()
{
	if (ccc.capturingPhase()==inheritedPhase+1) return true;
}

exports.shouldAutomateSSO = function()
{
	if (ccc.capturingPhase()==inheritedPhase+2) return true;
}

exports.init = function(param)
{
	//This is executed first (entry point) of this file. Init should happen here.
	ccc.log("Control transferred to checkCode module.");
	if ((ccc.detectionMode() & CONST.dm.code_vul) == 0) {
		//Shouldn't check code because this mode is disabled, hand over to the next module
		nextModule();
		return;
	}
	if (ccc.usedFBSDK()) {
		ccc.log(ccc.siteToTest() + " is not vulnerable to [2], app uses FB SDK.", true);
		ccc.log(ccc.siteToTest() + " is not vulnerable to [2], app uses FB SDK.");
		nextModule();
		return;
	}
	//only test app that uses FB SDK.
	observerService.addObserver(httpRequestObserver, "http-on-examine-response", false);
	inheritedPhase = param;
	var storageRecord = ccc.storageRecord();
	var codeVul = checkCode(storageRecord[ccc.siteToTest()]);
	if (codeVul)
	{
		verifyThreat(ccc.testSuiteWorker());
	}
}

exports.processLoaded = function(url)
{
	var capturingPhase = ccc.capturingPhase();
	if (inheritedPhase == 9999) return capturingPhase;			//shortcut to cut unnecessary checks.
	sawDialogOAuth = false;
	if (checkAgainstFilter(url,capturingPhase)){
		ccc.log("Phase "+inheritedPhase.toString()+": cleared cookies, revisited the site. Now ready to send exploit request.\n");
		return capturingPhase + 1;
	}
	else return capturingPhase;
}

exports.cleanup = function(){
	window.clearTimeout(delayRefreshTestTabTimer);
	window.clearTimeout(checkLoginButtonRemovedTimer);
}
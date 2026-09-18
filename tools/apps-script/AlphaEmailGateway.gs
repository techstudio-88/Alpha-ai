function doGet(){return ContentService.createTextOutput(JSON.stringify({ok:true,service:"alpha-email-gateway"})).setMimeType(ContentService.MimeType.JSON);}

function doPost(e){
  try{
    var secret=PropertiesService.getScriptProperties().getProperty("ALPHA_EMAIL_SECRET");
    var body=JSON.parse((e&&e.postData&&e.postData.contents)||"{}");
    if(!secret||body.secret!==secret)return json({ok:false,error:"Unauthorized"});
    var messages=Array.isArray(body.messages)?body.messages:[];
    if(!messages.length)return json({ok:false,error:"No messages"});
    if(messages.length>5)return json({ok:false,error:"Too many messages"});
    messages.forEach(function(m){
      if(!m.to||!m.subject||!m.html)throw new Error("Invalid message payload");
      MailApp.sendEmail({to:m.to,subject:m.subject,htmlBody:m.html,body:m.text||"Please open this email in an HTML-capable mail client."});
    });
    return json({ok:true,sent:messages.length});
  }catch(err){return json({ok:false,error:String(err&&err.message?err.message:err)});}
}
function json(payload){return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);}

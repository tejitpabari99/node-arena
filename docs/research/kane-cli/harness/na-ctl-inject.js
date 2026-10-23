(function(){
  var sel=null;
  function mk(){
    var p=document.createElement('div');
    p.id='na-ctl';
    p.style.cssText='position:fixed;top:8px;left:8px;z-index:2147483647;background:#fff;color:#000;padding:8px;border:2px solid #000;font:14px sans-serif;max-width:260px';
    p.setAttribute('role','region');p.setAttribute('aria-label','Test controls');
    function btn(t,f){var b=document.createElement('button');b.textContent=t;b.style.cssText='display:block;margin:3px 0;padding:6px 8px;width:100%;font-size:14px';b.onclick=f;p.appendChild(b);return b;}
    var log=document.createElement('div');log.id='na-log';log.style.cssText='margin-top:6px;font-size:13px';
    btn('Select b0 (blue, 20)',function(){sel='b0';log.appendChild(line('Selected b0'));});
    ['b3','b2','b4','b1'].forEach(function(t){btn('Send to '+t,function(){
      if(!sel){log.appendChild(line('Nothing selected'));return;}
      var from=sel,n=window.__na,k=n.events.length,r=null;
      var fi=+from.slice(1),ti=+t.slice(1);
      try{r=n.submit({type:'DrawLine',player:0,from:fi,to:ti});}catch(e){r=null;}
      window.__na_last=r;
      var row=line('Sending '+from+'\u2192'+t+' ...');log.appendChild(row);
      setTimeout(function(){
        var rj=n.events.slice(k).filter(function(e){return e.type==='CommandRejected'&&e.player===0;})[0];
        row.textContent='Sent '+from+'\u2192'+t+' ('+(rj?'rejected: '+rj.reason:(r?'accepted':'rejected: no driver'))+')';
      },600);
      sel=null;
    });});
    p.appendChild(log);document.body.appendChild(p);
  }
  function line(t){var d=document.createElement('div');d.textContent=t;return d;}
  var iv=setInterval(function(){if(window.__na&&document.body&&!document.getElementById('na-ctl')){mk();}},300);
})();

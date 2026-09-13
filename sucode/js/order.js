var API = "https://mywebservices-d7g2h7ghpe7c3b32c.service.tcloudbase.com/api/sucode";
var FEEDBACK = "https://mywebservices-d7g2h7ghpe7c3b32c.service.tcloudbase.com/api/feedback";
var params = new URLSearchParams(location.search);
var shopCode = (params.get("shop") || "").trim();
var tableNo = (params.get("table") || "").trim();
var menu = [];
var cart = {};
var activeCat = "";

function $(id) { return document.getElementById(id); }

function yuan(cent) { return "¥" + (cent / 100).toFixed(2); }

function post(action, extra) {
  var body = Object.assign({ action: action }, extra || {});
  return fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(function (res) {
    return res.json().then(function (data) {
      if (!res.ok || !data.ok) throw new Error(data.error || "请求失败");
      return data;
    });
  }).catch(function (err) {
    var msg = (err && err.message) || "请求失败";
    if (msg === "Failed to fetch" || msg === "NetworkError when attempting to fetch resource." || msg === "Network request failed") {
      throw new Error("菜单加载失败，请检查网络后重试");
    }
    throw err;
  });
}

function reportVisit() {
  try {
    if (sessionStorage.getItem("sucode_visit")) return;
    var visitor = localStorage.getItem("sucode_visitor");
    if (!visitor) {
      visitor = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
      localStorage.setItem("sucode_visitor", visitor);
    }
    fetch(FEEDBACK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "visit",
        page: "sucode/order",
        sessionId: visitor,
        visitorId: visitor,
        userAgent: navigator.userAgent,
        platform: "web"
      })
    }).then(function (res) {
      if (res.ok) sessionStorage.setItem("sucode_visit", "1");
    }).catch(function () {});
  } catch (e) {}
}

function cats() {
  var set = [];
  menu.forEach(function (it) {
    if (set.indexOf(it.category) < 0) set.push(it.category);
  });
  return set;
}

function renderCats() {
  var box = $("cats");
  box.innerHTML = "";
  cats().forEach(function (c) {
    var b = document.createElement("button");
    b.className = "cat" + (c === activeCat ? " active" : "");
    b.textContent = c;
    b.onclick = function () { setCat(c); };
    box.appendChild(b);
  });
  var active = box.querySelector(".active");
  if (active && active.scrollIntoView) {
    active.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }
}

function setCat(name) {
  if (!name || name === activeCat) return;
  activeCat = name;
  renderCats();
  renderList();
}

function switchCat(delta) {
  var list = cats();
  var i = list.indexOf(activeCat);
  if (i < 0) i = 0;
  var next = i + delta;
  if (next < 0 || next >= list.length) return;
  setCat(list[next]);
}

function bindSwipe(el) {
  if (!el) return;
  var startX = 0;
  var startY = 0;
  var tracking = false;
  el.addEventListener("touchstart", function (e) {
    if (e.touches.length !== 1) return;
    tracking = true;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener("touchend", function (e) {
    if (!tracking) return;
    tracking = false;
    var t = e.changedTouches[0];
    var dx = t.clientX - startX;
    var dy = t.clientY - startY;
    if (Math.abs(dx) < 56 || Math.abs(dx) <= Math.abs(dy)) return;
    if (dx < 0) switchCat(1);
    else switchCat(-1);
  }, { passive: true });
}

function renderList() {
  var box = $("list");
  box.innerHTML = "";
  menu.filter(function (it) { return !activeCat || it.category === activeCat; }).forEach(function (it) {
    var card = document.createElement("button");
    card.type = "button";
    card.className = "card";
    var qty = cart[it.id] || 0;
    var name = document.createElement("div");
    name.className = "name";
    name.textContent = it.name;
    var price = document.createElement("div");
    price.className = "price";
    price.textContent = yuan(it.priceCent);
    card.appendChild(name);
    card.appendChild(price);
    if (qty > 0) {
      var badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = String(qty);
      card.appendChild(badge);
    }
    card.onclick = function () { changeQty(it.id, 1); };
    box.appendChild(card);
  });
}

function renderCart() {
  var lines = cartLines();
  var empty = $("emptyCart");
  var chips = $("rowCart");
  chips.innerHTML = "";
  if (!lines.length) {
    empty.classList.remove("hidden");
    chips.classList.add("hidden");
    return;
  }
  empty.classList.add("hidden");
  chips.classList.remove("hidden");
  lines.forEach(function (line) {
    var chip = document.createElement("span");
    chip.className = "chip";
    chip.appendChild(document.createTextNode(line.item.name + " "));
    var qtyEl = document.createElement("strong");
    qtyEl.className = "qty";
    qtyEl.textContent = "×" + line.qty;
    chip.appendChild(qtyEl);
    var x = document.createElement("button");
    x.type = "button";
    x.setAttribute("aria-label", "减少一份");
    x.textContent = "×";
    x.onclick = function (e) {
      e.stopPropagation();
      changeQty(line.item.id, -1);
    };
    chip.onclick = function () { changeQty(line.item.id, -1); };
    chip.appendChild(x);
    chips.appendChild(chip);
  });
}

function changeQty(id, delta) {
  var n = (cart[id] || 0) + delta;
  if (n <= 0) delete cart[id];
  else cart[id] = Math.min(20, n);
  renderList();
  renderCart();
  renderBar();
}

function cartLines() {
  return menu.filter(function (it) { return cart[it.id]; }).map(function (it) {
    return { item: it, qty: cart[it.id] };
  });
}

function cartTotal() {
  return cartLines().reduce(function (s, l) { return s + l.item.priceCent * l.qty; }, 0);
}

function renderBar() {
  var n = cartLines().reduce(function (s, l) { return s + l.qty; }, 0);
  $("barCount").textContent = n ? "已选 " + n + " 件" : "尚未选菜";
  $("barSum").textContent = yuan(cartTotal());
}

function showConfirm() {
  if (!cartLines().length) { alert("请先选择菜品"); return; }
  $("pageMenu").classList.add("hidden");
  $("pageConfirm").classList.remove("hidden");
  $("confirmList").innerHTML = cartLines().map(function (l) {
    return "<div class='confirm-row'><div>" + l.item.name + " ×" + l.qty + "</div><div>" + yuan(l.item.priceCent * l.qty) + "</div></div>";
  }).join("");
}

function showMenu() {
  $("pageConfirm").classList.add("hidden");
  $("pageMenu").classList.remove("hidden");
}

function submitOrder() {
  var btn = $("btnSubmit");
  btn.disabled = true;
  var body = {
    shopCode: shopCode,
    remark: $("remark").value || "",
    items: cartLines().map(function (l) {
      return { itemId: l.item.id, qty: l.qty };
    })
  };
  if (tableNo) body.tableNo = tableNo;
  post("order.create", body).then(function (data) {
    $("pageConfirm").classList.add("hidden");
    $("pageDone").classList.remove("hidden");
    var dayNo = data.order && data.order.dayNo;
    $("doneNo").textContent = dayNo > 0 ? ("#" + dayNo) : data.order.publicNo;
    $("doneMsg").textContent = tableNo
      ? "已下单，请稍候，店员正在接单。到店结账。"
      : "已下单。请向店员出示订单号，到店结账。";
  }).catch(function (err) {
    alert(err.message);
    btn.disabled = false;
  });
}

function boot() {
  if (!shopCode) {
    $("pageMenu").classList.add("hidden");
    $("err").classList.remove("hidden");
    $("err").textContent = "请扫描桌上二维码打开本页（缺少门店参数）。";
    return;
  }
  $("meta").textContent = tableNo ? ("桌 " + tableNo) : "未分桌 · 全店码";
  post("menu.list", { shopCode: shopCode }).then(function (data) {
    $("shopName").textContent = (data.shop && data.shop.name) || "码上点单";
    menu = data.items || [];
    if (!menu.length) {
      $("pageMenu").classList.add("hidden");
      $("err").classList.remove("hidden");
      $("err").textContent = "本店菜单尚未上架，请向店员确认。";
      return;
    }
    activeCat = cats()[0] || "";
    renderCats();
    renderList();
    renderCart();
    renderBar();
    reportVisit();
  }).catch(function (err) {
    $("pageMenu").classList.add("hidden");
    $("err").classList.remove("hidden");
    $("err").textContent = err.message;
  });
}

document.addEventListener("DOMContentLoaded", function () {
  $("btnCheckout").onclick = showConfirm;
  $("btnBack").onclick = showMenu;
  $("btnSubmit").onclick = submitOrder;
  bindSwipe($("listWrap"));
  boot();
});

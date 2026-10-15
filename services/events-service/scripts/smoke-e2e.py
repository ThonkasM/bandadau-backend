#!/usr/bin/env python3
"""Real flow across identity-service and events-service (needs scripts/simulate-participants.py running for the saga).

  python3 scripts/smoke-e2e.py --identity http://localhost:7001 --events http://localhost:7004 \
      --mailpit http://localhost:8025 [--expect-failure]

Registers an organizer and a student (code read from Mailpit), creates and publishes events, registers and polls
until the registration is final. With --expect-failure the ticketing simulator must be running with --fail-ticketing.
"""
import argparse, json, re, sys, time, urllib.request, urllib.error, uuid

def req(method, url, body=None, token=None, headers=None):
    h = {"Content-Type": "application/json"}
    if token: h["Authorization"] = "Bearer " + token
    h.update(headers or {})
    r = urllib.request.Request(url, method=method, data=None if body is None else json.dumps(body).encode(), headers=h)
    try:
        with urllib.request.urlopen(r) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None), resp.headers
    except urllib.error.HTTPError as e:
        raw = e.read()
        return e.code, (json.loads(raw) if raw else None), e.headers

def main():
    a = argparse.ArgumentParser()
    a.add_argument("--identity", default="http://localhost:7001")
    a.add_argument("--events", default="http://localhost:7004")
    a.add_argument("--mailpit", default="http://localhost:8025")
    a.add_argument("--expect-failure", action="store_true")
    args = a.parse_args()
    run = uuid.uuid4().hex[:6]
    password = "Bandada#2026"
    actor = str(uuid.uuid4())

    st, tok, _ = req("POST", args.identity + "/api/v1/auth/service-token", {"clientId": "bandada-seed", "clientSecret": "dev-secret-seed"})
    assert st == 200, tok
    svc = tok["accessToken"]
    domain = f"u{run}.edu.bo"
    st, uni, _ = req("POST", args.identity + "/internal/v1/universities", {"name": f"Universidad {run}", "allowedDomains": [domain]}, svc, {"X-Actor-Id": actor})
    assert st == 201, uni

    def signup(local):
        email = f"{local}@{domain}"
        st, r, _ = req("POST", args.identity + "/api/v1/auth/register", {"email": email, "password": password, "universityId": uni["id"]}, None, {"Idempotency-Key": str(uuid.uuid4())})
        assert st == 201, r
        time.sleep(1)
        with urllib.request.urlopen(args.mailpit + "/api/v1/search?query=" + urllib.parse.quote("to:" + email)) as resp:
            msgs = json.load(resp)["messages"]
        with urllib.request.urlopen(args.mailpit + "/api/v1/message/" + msgs[0]["ID"]) as resp:
            code = re.search(r"\b(\d{6})\b", json.load(resp)["Text"]).group(1)
        st, session, _ = req("POST", args.identity + "/api/v1/auth/verify-email", {"email": email, "code": code})
        assert st == 200, session
        return email, session["user"]["id"]

    import urllib.parse
    org_email, org_id = signup("org")
    st, _, _ = req("PATCH", f"{args.identity}/internal/v1/users/{org_id}/roles", {"roles": ["STUDENT", "ORGANIZER"]}, svc, {"X-Actor-Id": actor})
    assert st == 200
    st, org, _ = req("POST", args.identity + "/api/v1/auth/login", {"email": org_email, "password": password})
    lucia_email, lucia_id = signup("lucia")
    st, lucia, _ = req("POST", args.identity + "/api/v1/auth/login", {"email": lucia_email, "password": password})
    otok, ltok = org["accessToken"], lucia["accessToken"]

    starts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 5 * 86400))
    st, ev, _ = req("POST", args.events + "/api/v1/events", {"title": f"Taller {run}", "description": "demo", "startsAt": starts, "venue": "Aula 1", "capacity": 5, "priceCredits": 20}, otok, {"Idempotency-Key": str(uuid.uuid4())})
    assert st == 201, ev
    st, ev, _ = req("POST", f"{args.events}/api/v1/events/{ev['id']}/publish", None, otok)
    assert st == 200 and ev["status"] == "PUBLISHED", ev
    st, pub, _ = req("GET", args.events + "/api/v1/events?public=true")
    assert st == 200 and any(e["id"] == ev["id"] for e in pub["items"]), pub
    st, reg, hdr = req("POST", f"{args.events}/api/v1/events/{ev['id']}/registrations", None, ltok, {"Idempotency-Key": str(uuid.uuid4())})
    assert st == 202 and reg["status"] == "PENDING", (st, reg)
    print("accepted", reg["id"], "Location:", hdr["Location"])
    final = "FAILED" if args.expect_failure else "CONFIRMED"
    for _ in range(60):
        st, cur, _ = req("GET", f"{args.events}/api/v1/registrations/{reg['id']}", None, ltok)
        if cur["status"] not in ("PENDING",): break
        time.sleep(1)
    print("final:", cur["status"], cur.get("failureReason"), cur.get("ticketId"))
    assert cur["status"] == final, cur
    st, ev2, _ = req("GET", f"{args.events}/api/v1/events/{ev['id']}", None, otok)
    print("seatsTaken:", ev2["seatsTaken"])
    assert ev2["seatsTaken"] == (0 if args.expect_failure else 1)
    print("OK")

if __name__ == "__main__":
    main()

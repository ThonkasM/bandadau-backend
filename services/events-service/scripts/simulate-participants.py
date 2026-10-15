#!/usr/bin/env python3
"""Development stand-in for wallet-service and ticketing-service (phase 1, before the real ones run).

Reads commands from a queue bound to bandada.commands through the RabbitMQ management API and publishes the
participant responses to bandada.events. Usage:
  python3 scripts/simulate-participants.py --mgmt http://localhost:15672 --user bandada --password bandada \
      --balance 100 [--fail-ticketing] [--silent-wallet]
It creates (and reuses) the queue sim.participants bound to bandada.wallet.cmd.# and bandada.ticketing.cmd.#.
"""
import argparse, base64, json, time, uuid, urllib.request
from datetime import datetime, timezone

def main():
    a = argparse.ArgumentParser()
    a.add_argument("--mgmt", default="http://localhost:15672")
    a.add_argument("--user", default="bandada")
    a.add_argument("--password", default="bandada")
    a.add_argument("--balance", type=int, default=100)
    a.add_argument("--fail-ticketing", action="store_true")
    a.add_argument("--silent-wallet", action="store_true")
    args = a.parse_args()
    auth = "Basic " + base64.b64encode(f"{args.user}:{args.password}".encode()).decode()

    def api(method, path, body=None):
        req = urllib.request.Request(args.mgmt + "/api" + path, method=method,
                                     data=None if body is None else json.dumps(body).encode(),
                                     headers={"Authorization": auth, "Content-Type": "application/json"})
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else None

    api("PUT", "/queues/%2F/sim.participants", {"durable": True, "arguments": {"x-queue-type": "quorum"}})
    for rk in ("bandada.wallet.cmd.#", "bandada.ticketing.cmd.#"):
        api("POST", "/bindings/%2F/e/bandada.commands/q/sim.participants", {"routing_key": rk})

    balances, debits, refunds, tickets, voided = {}, {}, {}, {}, set()
    now = lambda: datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    def publish(rtype, saga, data):
        ce = {"specversion": "1.0", "id": str(uuid.uuid4()), "source": "/services/simulator", "type": rtype, "time": now(),
              "datacontenttype": "application/json", "correlationid": "sim", "sagaid": saga, "data": data}
        api("POST", "/exchanges/%2F/bandada.events/publish", {"properties": {"content_type": "application/cloudevents+json",
            "delivery_mode": 2, "message_id": ce["id"], "type": rtype}, "routing_key": rtype, "payload": json.dumps(ce),
            "payload_encoding": "string"})

    print("simulating wallet and ticketing; Ctrl+C to stop")
    while True:
        msgs = api("POST", "/queues/%2F/sim.participants/get", {"count": 10, "ackmode": "ack_requeue_false", "encoding": "auto"})
        for m in msgs or []:
            ce = json.loads(m["payload"]); d = ce["data"]; saga = d["sagaId"]; reg = d["registrationId"]; t = ce["type"]
            print("<-", t, reg)
            if t.endswith("debit-credits.v1"):
                if args.silent_wallet: continue
                user = d["userId"]; amount = d["amountCredits"]; balances.setdefault(user, args.balance)
                if reg in refunds:
                    publish("bandada.wallet.credits-debit-failed.v1", saga, {"sagaId": saga, "registrationId": reg, "userId": user, "reason": "SAGA_ABORTED", "requiredCredits": amount, "balanceCredits": balances[user], "occurredAt": now()})
                elif reg not in debits and balances[user] < amount:
                    publish("bandada.wallet.credits-debit-failed.v1", saga, {"sagaId": saga, "registrationId": reg, "userId": user, "reason": "INSUFFICIENT_FUNDS", "requiredCredits": amount, "balanceCredits": balances[user], "occurredAt": now()})
                else:
                    if reg not in debits:
                        balances[user] -= amount; debits[reg] = amount
                    publish("bandada.wallet.credits-debited.v1", saga, {"sagaId": saga, "registrationId": reg, "userId": user, "ledgerEntryId": str(uuid.uuid4()), "amountCredits": amount, "balanceCredits": balances[user], "occurredAt": now()})
            elif t.endswith("refund-credits.v1"):
                user = d["userId"]
                if reg not in refunds:
                    refunds[reg] = debits.get(reg, 0); balances[user] = balances.get(user, args.balance) + refunds[reg]
                publish("bandada.wallet.credits-refunded.v1", saga, {"sagaId": saga, "registrationId": reg, "userId": user, "ledgerEntryId": str(uuid.uuid4()) if refunds[reg] else None, "amountCredits": refunds[reg], "balanceCredits": balances[user], "occurredAt": now()})
            elif t.endswith("issue-ticket.v1"):
                if reg in voided:
                    publish("bandada.ticketing.ticket-issue-failed.v1", saga, {"sagaId": saga, "registrationId": reg, "reason": "ALREADY_VOIDED", "detail": None, "occurredAt": now()})
                elif args.fail_ticketing:
                    publish("bandada.ticketing.ticket-issue-failed.v1", saga, {"sagaId": saga, "registrationId": reg, "reason": "CHAOS_INJECTED", "detail": None, "occurredAt": now()})
                else:
                    tid = tickets.setdefault(reg, str(uuid.uuid4()))
                    publish("bandada.ticketing.ticket-issued.v1", saga, {"sagaId": saga, "registrationId": reg, "ticketId": tid, "eventId": d["eventId"], "userId": d["userId"], "occurredAt": now()})
            elif t.endswith("void-ticket.v1"):
                voided.add(reg)
                publish("bandada.ticketing.ticket-voided.v1", saga, {"sagaId": saga, "registrationId": reg, "ticketId": tickets.get(reg), "occurredAt": now()})
        time.sleep(0.5)

if __name__ == "__main__":
    main()

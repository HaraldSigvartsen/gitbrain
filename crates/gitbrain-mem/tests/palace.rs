use gitbrain_mem::{NewDrawer, Palace, SearchOpts};

fn d(wing: &str, room: &str, text: &str) -> NewDrawer {
    NewDrawer {
        wing: wing.into(),
        room: room.into(),
        text: text.into(),
        source: None,
    }
}

fn opts(limit: usize) -> SearchOpts {
    SearchOpts {
        limit,
        ..Default::default()
    }
}

#[test]
fn add_then_search_returns_verbatim_text() {
    let tmp = tempfile::tempdir().unwrap();
    let p = Palace::open(tmp.path()).unwrap();
    let text = "We chose Durable Objects over KV because checkout needs strong consistency.\n  (keep this exact)";
    let stored = p.add(d("gitbrain", "decisions", text)).unwrap();
    p.add(d(
        "gitbrain",
        "handoff",
        "Next session: wire the MCP server into Cursor.",
    ))
    .unwrap();

    let hits = p.search("durable consistency", &opts(5)).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].drawer.id, stored.id);
    assert_eq!(hits[0].drawer.text, text, "text must be stored verbatim");
    assert!(hits[0].score > 0.0);
}

#[test]
fn search_can_be_scoped_to_wing_and_room() {
    let tmp = tempfile::tempdir().unwrap();
    let p = Palace::open(tmp.path()).unwrap();
    p.add(d("smakro", "pricing", "launch price is 299 per month"))
        .unwrap();
    p.add(d(
        "gitbrain",
        "pricing",
        "gitbrain is free and MIT licensed, price zero",
    ))
    .unwrap();
    p.add(d("gitbrain", "diary", "talked about price today"))
        .unwrap();

    let all = p.search("price", &opts(10)).unwrap();
    assert_eq!(all.len(), 3);

    let wing = p
        .search(
            "price",
            &SearchOpts {
                wing: Some("gitbrain".into()),
                limit: 10,
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(wing.len(), 2);
    assert!(wing.iter().all(|h| h.drawer.wing == "gitbrain"));

    let room = p
        .search(
            "price",
            &SearchOpts {
                wing: Some("gitbrain".into()),
                room: Some("pricing".into()),
                limit: 10,
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(room.len(), 1);
    assert_eq!(room[0].drawer.room, "pricing");
}

#[test]
fn list_wings_counts_rooms_and_drawers() {
    let tmp = tempfile::tempdir().unwrap();
    let p = Palace::open(tmp.path()).unwrap();
    assert!(p.list_wings().unwrap().is_empty());
    p.add_many(vec![
        d("harald", "diary", "a"),
        d("harald", "diary", "b"),
        d("harald", "family", "c"),
        d("smakro", "launch", "d"),
    ])
    .unwrap();
    let wings = p.list_wings().unwrap();
    assert_eq!(wings.len(), 2);
    assert_eq!(wings[0].wing, "harald");
    assert_eq!(wings[0].drawers, 3);
    assert_eq!(wings[0].rooms.len(), 2);
    assert_eq!(wings[0].rooms[0].room, "diary");
    assert_eq!(wings[0].rooms[0].drawers, 2);
    assert_eq!(wings[1].wing, "smakro");
}

#[test]
fn get_by_id_and_source_round_trip() {
    let tmp = tempfile::tempdir().unwrap();
    let p = Palace::open(tmp.path()).unwrap();
    let mut nd = d("w", "r", "hello");
    nd.source = Some("session:abc".into());
    let s = p.add(nd).unwrap();
    let got = p.get(&s.id).unwrap().unwrap();
    assert_eq!(got, s);
    assert_eq!(got.source.as_deref(), Some("session:abc"));
    assert!(p.get("nope").unwrap().is_none());
}

#[test]
fn rejects_empty_or_bad_names_and_text() {
    let tmp = tempfile::tempdir().unwrap();
    let p = Palace::open(tmp.path()).unwrap();
    assert!(p.add(d(" ", "r", "x")).is_err());
    assert!(p.add(d("w", "", "x")).is_err());
    assert!(p.add(d("w", "r", "   ")).is_err());
    assert!(p.add(d("w\nx", "r", "x")).is_err());
    assert!(p.add(d(&"a".repeat(129), "r", "x")).is_err());
    assert!(p.list_wings().unwrap().is_empty());
}

#[test]
fn query_syntax_errors_do_not_fail_and_accents_fold() {
    let tmp = tempfile::tempdir().unwrap();
    let p = Palace::open(tmp.path()).unwrap();
    p.add(d("harald", "notes", "Møte med Ålesund-kunden på fredag"))
        .unwrap();
    // unbalanced quotes / operators from agents must not error
    assert!(p.search("\"unclosed AND (", &opts(5)).is_ok());
    assert_eq!(p.search("alesund", &opts(5)).unwrap().len(), 1);
    assert_eq!(p.search("MØTE", &opts(5)).unwrap().len(), 1);
}

#[test]
fn two_handles_on_one_palace_see_each_others_writes() {
    let tmp = tempfile::tempdir().unwrap();
    let a = Palace::open(tmp.path()).unwrap();
    let b = Palace::open(tmp.path()).unwrap();
    a.add(d("cursor", "notes", "written by agent a")).unwrap();
    b.add(d("codex", "notes", "written by agent b")).unwrap();
    assert_eq!(a.search("written", &opts(10)).unwrap().len(), 2);
    assert_eq!(b.list_wings().unwrap().len(), 2);
}

#[test]
fn reopen_persists() {
    let tmp = tempfile::tempdir().unwrap();
    {
        let p = Palace::open(tmp.path()).unwrap();
        p.add(d("w", "r", "persistent memory")).unwrap();
    }
    let p = Palace::open(tmp.path()).unwrap();
    assert_eq!(p.search("persistent", &opts(5)).unwrap().len(), 1);
}

#[test]
fn many_single_writes_compact_and_stay_searchable() {
    let tmp = tempfile::tempdir().unwrap();
    let p = Palace::open(tmp.path()).unwrap();
    for i in 0..40 {
        p.add(d("w", "r", &format!("note number {i} about compaction")))
            .unwrap();
    }
    assert_eq!(p.search("compaction", &opts(100)).unwrap().len(), 40);
    assert_eq!(p.list_wings().unwrap()[0].drawers, 40);
}

use crate::events::{FhirSnapshotEvent, MockPatient, ScenarioId};

pub fn snapshot_for_scenario(scenario: ScenarioId) -> FhirSnapshotEvent {
    FhirSnapshotEvent {
        scenario,
        note: "模擬 FHIR データです。実診療データの救出は検証用の設計可能性確認のみを目的としています。"
            .to_string(),
        patients: vec![
            MockPatient {
                id: "pat-001".to_string(),
                name: "山田 太郎".to_string(),
                room: "診察室 2".to_string(),
                chief_complaint: "発熱・咳（継続診察中）".to_string(),
                last_vitals: "BT 37.8°C / SpO2 97% / HR 88".to_string(),
            },
            MockPatient {
                id: "pat-002".to_string(),
                name: "佐藤 花子".to_string(),
                room: "診察室 3".to_string(),
                chief_complaint: "糖尿病フォロー（処方調整待ち）".to_string(),
                last_vitals: "BT 36.5°C / SpO2 98% / HR 72".to_string(),
            },
            MockPatient {
                id: "pat-003".to_string(),
                name: "鈴木 一郎".to_string(),
                room: "受付待機".to_string(),
                chief_complaint: "初診・紹介状あり".to_string(),
                last_vitals: "未測定（受付時）".to_string(),
            },
        ],
    }
}

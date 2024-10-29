import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyAIw0Qc75fTr7C0xYwMqlgafbxABEYImb0",
  authDomain: "bitacora-peces.firebaseapp.com",
  projectId: "bitacora-peces",
  storageBucket: "bitacora-peces.appspot.com",
  messagingSenderId: "479926767904",
  appId: "1:479926767904:web:9b1b062bec0d1280e6c745",
  measurementId: "G-B5BQHY5NPN",
  databaseURL: "https://bitacora-peces-default-rtdb.firebaseio.com/"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
const database = getDatabase(app);
const storage = getStorage(app);

export { auth, database, storage };
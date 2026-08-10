import fs from 'fs'
import crypto from 'crypto'
import { storageUpload, storagePublicGet, storageAuthGet, assert } from './lib.mjs'

const { A, B } = JSON.parse(fs.readFileSync(new URL('./storage-state.json', import.meta.url), 'utf8'))
const bytes = Buffer.from('qa-test-image-bytes')
const docBytes = Buffer.from('qa-test-document-bytes')

console.log('\n=== student-photos: path {studentId}.jpg ===')
const photoPath = `${A.studentId}.jpg`
const noAuthUpload = await storageUpload('student-photos', photoPath, bytes, {})
assert(!noAuthUpload.ok, 'fully unauthenticated upload BLOCKED', noAuthUpload.body)

const crossAcadUpload = await storageUpload('student-photos', photoPath, bytes, { staffToken: B.staffToken })
assert(!crossAcadUpload.ok, "academy B staff BLOCKED from overwriting academy A's student photo", crossAcadUpload.body)

const ownerUpload = await storageUpload('student-photos', photoPath, bytes, { ownerJwt: A.ownerJwt })
assert(ownerUpload.ok, 'academy A owner ALLOWED to upload own student photo', ownerUpload.body)

const staffUpload = await storageUpload('student-photos', photoPath, bytes, { staffToken: A.staffToken })
assert(staffUpload.ok, 'academy A staff (students.manage) ALLOWED to upload own-academy student photo', staffUpload.body)

const selfUpload = await storageUpload('student-photos', photoPath, bytes, { studentToken: A.studentToken })
assert(selfUpload.ok, 'the student themselves ALLOWED to upload own photo', selfUpload.body)

const publicRead = await storagePublicGet('student-photos', photoPath)
assert(publicRead.ok, 'photo still PUBLICLY READABLE via public URL (unchanged behavior)', publicRead)

console.log('\n=== staff-photos: path staff/{staffId}.jpg ===')
const staffPhotoPath = `staff/${A.staffId}.jpg`
const noAuthStaffUpload = await storageUpload('staff-photos', staffPhotoPath, bytes, {})
assert(!noAuthStaffUpload.ok, 'fully unauthenticated upload BLOCKED', noAuthStaffUpload.body)
const crossAcadStaffUpload = await storageUpload('staff-photos', staffPhotoPath, bytes, { staffToken: B.staffToken })
assert(!crossAcadStaffUpload.ok, "academy B staff BLOCKED from overwriting academy A's staff photo", crossAcadStaffUpload.body)
const ownerStaffUpload = await storageUpload('staff-photos', staffPhotoPath, bytes, { ownerJwt: A.ownerJwt })
assert(ownerStaffUpload.ok, 'academy A owner ALLOWED to upload staff photo', ownerStaffUpload.body)
const selfStaffUpload = await storageUpload('staff-photos', staffPhotoPath, bytes, { staffToken: A.staffToken })
assert(selfStaffUpload.ok, 'the staff member themselves ALLOWED to upload own photo', selfStaffUpload.body)

console.log('\n=== branch-photos: path {branchId}.jpg (owner-only) ===')
const branchPhotoPath = `${A.branchId}.jpg`
const noAuthBranchUpload = await storageUpload('branch-photos', branchPhotoPath, bytes, {})
assert(!noAuthBranchUpload.ok, 'fully unauthenticated upload BLOCKED', noAuthBranchUpload.body)
const crossAcadBranchUpload = await storageUpload('branch-photos', branchPhotoPath, bytes, { ownerJwt: B.ownerJwt })
assert(!crossAcadBranchUpload.ok, "academy B owner BLOCKED from overwriting academy A's branch photo", crossAcadBranchUpload.body)
const ownerBranchUpload = await storageUpload('branch-photos', branchPhotoPath, bytes, { ownerJwt: A.ownerJwt })
assert(ownerBranchUpload.ok, 'academy A owner ALLOWED to upload own branch photo', ownerBranchUpload.body)
const publicBranchRead = await storagePublicGet('branch-photos', branchPhotoPath)
assert(publicBranchRead.ok, 'branch photo still PUBLICLY READABLE (unchanged)', publicBranchRead)

console.log('\n=== student-documents: now PRIVATE bucket, path {studentId}/{uuid}.ext ===')
const docPath = `${A.studentId}/${crypto.randomUUID()}.pdf`
const noAuthDocUpload = await storageUpload('student-documents', docPath, docBytes, {})
assert(!noAuthDocUpload.ok, 'fully unauthenticated upload BLOCKED', noAuthDocUpload.body)
const crossAcadDocUpload = await storageUpload('student-documents', docPath, docBytes, { staffToken: B.staffToken })
assert(!crossAcadDocUpload.ok, "academy B staff BLOCKED from uploading into academy A student's folder", crossAcadDocUpload.body)
const staffDocUpload = await storageUpload('student-documents', docPath, docBytes, { staffToken: A.staffToken })
assert(staffDocUpload.ok, 'academy A staff (students.manage) ALLOWED to upload document', staffDocUpload.body)

const publicDocRead = await storagePublicGet('student-documents', docPath)
assert(!publicDocRead.ok, 'OLD public-URL pattern now BLOCKED (bucket is private)', publicDocRead)

const noAuthDocRead = await storageAuthGet('student-documents', docPath, {})
assert(!noAuthDocRead.ok, 'unauthenticated authenticated-endpoint read BLOCKED', noAuthDocRead)
const crossAcadDocRead = await storageAuthGet('student-documents', docPath, { staffToken: B.staffToken })
assert(!crossAcadDocRead.ok, "academy B staff BLOCKED from reading academy A's student document", crossAcadDocRead)
const ownAcadDocRead = await storageAuthGet('student-documents', docPath, { staffToken: A.staffToken })
assert(ownAcadDocRead.ok, 'academy A staff (documents.view) ALLOWED to read the document', ownAcadDocRead)
const selfDocRead = await storageAuthGet('student-documents', docPath, { studentToken: A.studentToken })
assert(selfDocRead.ok, 'the student themselves ALLOWED to read own document', selfDocRead)

console.log('\n=== trial-documents: now PRIVATE, uploader-only ===')
const trialDocPath = `${A.ownerId}/${crypto.randomUUID()}.pdf`
const noAuthTrialUpload = await storageUpload('trial-documents', trialDocPath, docBytes, {})
assert(!noAuthTrialUpload.ok, 'fully unauthenticated upload BLOCKED', noAuthTrialUpload.body)
const otherOwnerTrialUpload = await storageUpload('trial-documents', trialDocPath, docBytes, { ownerJwt: B.ownerJwt })
assert(!otherOwnerTrialUpload.ok, "a different authenticated user BLOCKED from uploading into someone else's uid folder", otherOwnerTrialUpload.body)
const selfTrialUpload = await storageUpload('trial-documents', trialDocPath, docBytes, { ownerJwt: A.ownerJwt })
assert(selfTrialUpload.ok, 'the matching auth.uid() ALLOWED to upload into own folder', selfTrialUpload.body)

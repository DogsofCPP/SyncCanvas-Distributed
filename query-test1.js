/**
 * 清除 strokes 集合中的所有文档
 */
const { MongoClient } = require('mongodb');

(async () => {
  const c = new MongoClient('mongodb://localhost:27017');
  await c.connect();
  const db = c.db('synccanvas');

  // 删除所有 stroke_id 为 undefined/null/不存在的文档
  const result = await db.collection('strokes').deleteMany({
    $or: [
      { stroke_id: { $exists: false } },
      { stroke_id: null },
      { stroke_id: undefined }
    ]
  });
  console.log(`已删除 stroke_id 无效的文档: ${result.deletedCount} 条`);

  // 也删除 stroke_id 为空字符串的
  const result2 = await db.collection('strokes').deleteMany({
    stroke_id: ''
  });
  console.log(`已删除 stroke_id 为空字符串的文档: ${result2.deletedCount} 条`);

  // 验证清理结果
  const all = await db.collection('strokes').find({}).toArray();
  const bad = all.filter(d => !d.stroke_id);
  console.log(`清理后数据库总记录: ${all.length}, 无效 stroke_id 记录: ${bad.length}`);

  if (bad.length > 0) {
    console.log('仍存在的无效记录:');
    bad.forEach(d => console.log(`  _id=${d._id}, stroke_id=${d.stroke_id}, action=${d.action}`));
  }

  await c.close();
})();

package com.synccanvas.persistence.repository;

import java.util.List;

import com.synccanvas.persistence.model.CanvasOperation;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.repository.MongoRepository;

/**
 * 画布操作 MongoDB 仓库，负责 operations 集合的读写。
 */
public interface CanvasOperationRepository extends MongoRepository<CanvasOperation, String> {

    /**
     * 查询指定序列号之后的操作，并按序列号升序返回。
     *
     * @param sequenceId 起始序列号
     * @param pageable 分页参数，用于限制返回数量
     * @return 操作列表
     */
    List<CanvasOperation> findBySequenceIdGreaterThanOrderBySequenceIdAsc(Long sequenceId, Pageable pageable);
}

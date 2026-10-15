package com.bandadau.identity.adapter.in.web;

import com.bandadau.identity.adapter.in.web.dto.Responses.PageResponse;
import com.bandadau.identity.adapter.in.web.dto.Responses.UniversityResponse;
import com.bandadau.identity.application.port.in.ListUniversitiesUseCase;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/universities")
public class UniversityController {
    private final ListUniversitiesUseCase list;

    public UniversityController(ListUniversitiesUseCase list) {
        this.list = list;
    }

    @GetMapping
    public PageResponse<UniversityResponse> listUniversities(@RequestParam(required = false) String cursor,
                                                             @RequestParam(defaultValue = "20") int limit) {
        return PageResponse.from(list.listEnabled(cursor, Limits.check(limit)), UniversityResponse::from);
    }
}
